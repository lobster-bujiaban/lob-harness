import type { ToolSchema } from "./llm.ts";
import { throwIfAborted } from "./errors.ts";
import { randomUUID } from "node:crypto";

export type ToolExecutionMode = { kind: "parallel" } | { kind: "exclusive" };
export type ToolExecutionContext = {
  signal: AbortSignal;
  execution: Readonly<ToolExecution>;
};
export type ToolExecution = {
  id: string;
  name: string;
  args: unknown;
  signal: AbortSignal;
  recordApproval?: (event: ApprovalAuditEvent) => void | Promise<void>;
};
export type ToolExecutionResult =
  | { output: string; isError: false }
  | { output: string; isError: true; error: { message: string; code: string } };
export type PreToolDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  | { kind: "ask"; reason?: string };
export type ApprovalOutcome =
  | "allowed-once"
  | "rejected"
  | "cancelled"
  | "unavailable";
export type ApprovalRequest = {
  callId: string;
  toolName: string;
  arguments: unknown;
  reason?: string;
  signal: AbortSignal;
};
export type ApprovalAuditEvent =
  | {
      type: "asked";
      id: string;
      callId: string;
      toolName: string;
      reason?: string;
    }
  | { type: "decided"; id: string; outcome: ApprovalOutcome };
export interface ApprovalProvider {
  request(request: Readonly<ApprovalRequest>): ApprovalOutcome | Promise<ApprovalOutcome>;
}
export type PostToolDecision =
  | { kind: "accept"; output?: string }
  | { kind: "block"; feedback: string };
export type PreExecute = (
  execution: Readonly<ToolExecution>,
  next: () => Promise<PreToolDecision>,
) => PreToolDecision | Promise<PreToolDecision>;
export type Execute = (
  execution: Readonly<ToolExecution>,
  next: () => Promise<ToolExecutionResult>,
) => ToolExecutionResult | Promise<ToolExecutionResult>;
export type PostExecute = (
  execution: Readonly<ToolExecution>,
  result: Readonly<ToolExecutionResult>,
  next: () => Promise<PostToolDecision>,
) => PostToolDecision | Promise<PostToolDecision>;

export type ToolDefinition = ToolSchema & {
  executionMode: ToolExecutionMode;
  timeoutMs?: number;
  execute(args: unknown, context: ToolExecutionContext): string | Promise<string>;
};

export class ToolError extends Error {
  constructor(
    message: string,
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ToolError";
  }
}

/** 最小工具注册表：定义所有权、模型 schema 投影和执行分派位于同一处。 */
export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>();
  private readonly preExecuteListeners: PreExecute[] = [];
  private readonly executeListeners: Execute[] = [];
  private readonly postExecuteListeners: PostExecute[] = [];
  private approvalProvider?: ApprovalProvider;

  register(definition: ToolDefinition): () => void {
    const snapshot = validateDefinition(definition);
    if (this.definitions.has(snapshot.name)) {
      throw new Error(`tool "${snapshot.name}" is already registered`);
    }
    this.definitions.set(snapshot.name, snapshot);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (this.definitions.get(snapshot.name) === snapshot) {
        this.definitions.delete(snapshot.name);
      }
    };
  }

  get(name: string): ToolDefinition | undefined {
    return this.definitions.get(name);
  }

  schemas(): ToolSchema[] {
    return [...this.definitions.values()].map(({ name, description, parameters }) => ({
      name,
      description,
      parameters: structuredClone(parameters),
    }));
  }

  executionMode(name: string): ToolExecutionMode {
    return this.definitions.get(name)?.executionMode ?? { kind: "exclusive" };
  }

  onPreExecute(listener: PreExecute): () => void {
    return registerListener(this.preExecuteListeners, listener);
  }

  onExecute(listener: Execute): () => void {
    return registerListener(this.executeListeners, listener);
  }

  onPostExecute(listener: PostExecute): () => void {
    return registerListener(this.postExecuteListeners, listener);
  }

  provideApproval(provider: ApprovalProvider): () => void {
    if (this.approvalProvider !== undefined) {
      throw new Error("approval provider is already registered");
    }
    this.approvalProvider = provider;
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (this.approvalProvider === provider) this.approvalProvider = undefined;
    };
  }

  async execute(
    name: string,
    args: unknown,
    callerSignal: AbortSignal,
    id = "unknown",
    recordApproval?: (event: ApprovalAuditEvent) => void | Promise<void>,
  ): Promise<ToolExecutionResult> {
    throwIfAborted(callerSignal);
    const timeoutMs = this.definitions.get(name)?.timeoutMs;
    if (timeoutMs === undefined) {
      return this.executeWithSignal(name, args, callerSignal, id, recordApproval);
    }
    const timeout = new AbortController();
    const timer = setTimeout(() => {
      timeout.abort(new DOMException("tool deadline reached", "TimeoutError"));
    }, timeoutMs);
    const signal = AbortSignal.any([callerSignal, timeout.signal]);
    try {
      const result = await this.executeWithSignal(name, args, signal, id, recordApproval);
      throwIfAborted(callerSignal);
      return timeout.signal.aborted
        ? failure(`tool timed out after ${timeoutMs}ms`, "TOOL_TIMEOUT")
        : result;
    } catch (error) {
      throwIfAborted(callerSignal);
      if (timeout.signal.aborted) {
        return failure(`tool timed out after ${timeoutMs}ms`, "TOOL_TIMEOUT");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async executeWithSignal(
    name: string,
    args: unknown,
    signal: AbortSignal,
    id: string,
    recordApproval?: (event: ApprovalAuditEvent) => void | Promise<void>,
  ): Promise<ToolExecutionResult> {
    throwIfAborted(signal);
    const definition = this.definitions.get(name);
    const execution = Object.freeze({
      id,
      name,
      args: structuredClone(args),
      signal,
      ...(recordApproval === undefined ? {} : { recordApproval }),
    });
    let result: ToolExecutionResult;
    try {
      const decision = await waterfall<PreExecute, PreToolDecision>(
        this.preExecuteListeners,
        (listener, next) => listener(execution, next),
        async () => ({ kind: "allow" as const }),
      );
      throwIfAborted(signal);
      const gate = decision.kind === "ask"
        ? await this.resolveApproval(execution, decision)
        : decision;
      throwIfAborted(signal);
      if (gate.kind === "deny") {
        result = failure(`tool denied: ${gate.reason}`, "DENIED");
      } else if (definition === undefined) {
        result = failure(`unknown tool: ${name}`, "UNKNOWN_TOOL");
      } else {
        try {
          result = await waterfall<Execute, ToolExecutionResult>(
            this.executeListeners,
            (listener, next) => listener(execution, next),
            async () => {
              const output = await definition.execute(execution.args, { signal, execution });
              throwIfAborted(signal);
              if (typeof output !== "string") {
                throw new Error(`tool "${name}" returned a non-string output`);
              }
              return { output, isError: false as const };
            },
          );
        } catch (error) {
          throwIfAborted(signal);
          result = failure(
            errorMessage(error),
            error instanceof ToolError ? error.code : "TOOL_ERROR",
          );
        }
      }
      const post = await waterfall<PostExecute, PostToolDecision>(
        this.postExecuteListeners,
        (listener, next) => listener(execution, result, next),
        async () => ({ kind: "accept" as const }),
      );
      throwIfAborted(signal);
      if (post.kind === "block") {
        return failure(post.feedback, "POST_BLOCKED");
      }
      if (post.output !== undefined) return { ...result, output: post.output };
      return result;
    } catch (error) {
      throwIfAborted(signal);
      return failure(
        errorMessage(error),
        error instanceof ToolError ? error.code : "TOOL_ERROR",
      );
    }
  }

  private async resolveApproval(
    execution: Readonly<ToolExecution>,
    decision: Extract<PreToolDecision, { kind: "ask" }>,
  ): Promise<Exclude<PreToolDecision, { kind: "ask" }>> {
    const approvalId = randomUUID();
    await execution.recordApproval?.({
      type: "asked",
      id: approvalId,
      callId: execution.id,
      toolName: execution.name,
      ...(decision.reason === undefined ? {} : { reason: decision.reason }),
    });
    const outcome = await requestApproval(this.approvalProvider, {
      callId: execution.id,
      toolName: execution.name,
      arguments: structuredClone(execution.args),
      ...(decision.reason === undefined ? {} : { reason: decision.reason }),
      signal: execution.signal,
    });
    await execution.recordApproval?.({ type: "decided", id: approvalId, outcome });
    switch (outcome) {
      case "allowed-once":
        return { kind: "allow" };
      case "rejected":
        return { kind: "deny", reason: `approval rejected for tool "${execution.name}"` };
      case "cancelled":
        return { kind: "deny", reason: `approval cancelled for tool "${execution.name}"` };
      case "unavailable":
        return {
          kind: "deny",
          reason: `tool "${execution.name}" requires approval, but no approval channel is available`,
        };
    }
  }
}

export type ToolBatchCall = { id: string; name: string; args: unknown };

/** 按模型顺序规划 barrier，允许 parallel 主体有限重叠，返回值仍与输入同序。 */
export async function executeToolBatch(
  registry: ToolRegistry,
  calls: readonly ToolBatchCall[],
  options: {
    signal: AbortSignal;
    maxConcurrency: number;
    recordApproval?: (
      call: Readonly<ToolBatchCall>,
      event: ApprovalAuditEvent,
    ) => void | Promise<void>;
  },
): Promise<ToolExecutionResult[]> {
  if (!Number.isSafeInteger(options.maxConcurrency) || options.maxConcurrency <= 0) {
    throw new Error("maxToolConcurrency must be a positive safe integer");
  }
  const results: ToolExecutionResult[] = new Array(calls.length);
  let cursor = 0;
  while (cursor < calls.length) {
    throwIfAborted(options.signal);
    const first = calls[cursor];
    if (first === undefined) break;
    if (registry.executionMode(first.name).kind === "exclusive") {
      results[cursor] = await executeOne(registry, first, options);
      cursor += 1;
      continue;
    }
    let end = cursor + 1;
    while (
      end < calls.length
      && registry.executionMode(calls[end]?.name ?? "").kind === "parallel"
    ) end += 1;
    await executeParallelGroup(registry, calls, results, cursor, end, options);
    cursor = end;
  }
  return results;
}

async function executeParallelGroup(
  registry: ToolRegistry,
  calls: readonly ToolBatchCall[],
  results: ToolExecutionResult[],
  start: number,
  end: number,
  options: Parameters<typeof executeToolBatch>[2],
): Promise<void> {
  let next = start;
  const workers = Array.from(
    { length: Math.min(options.maxConcurrency, end - start) },
    async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= end) return;
        const call = calls[index];
        if (call === undefined) return;
        results[index] = await executeOne(registry, call, options);
      }
    },
  );
  const settled = await Promise.allSettled(workers);
  throwIfAborted(options.signal);
  const rejected = settled.find(
    (item): item is PromiseRejectedResult => item.status === "rejected",
  );
  if (rejected !== undefined) throw rejected.reason;
}

function executeOne(
  registry: ToolRegistry,
  call: Readonly<ToolBatchCall>,
  options: Parameters<typeof executeToolBatch>[2],
): Promise<ToolExecutionResult> {
  return registry.execute(
    call.name,
    call.args,
    options.signal,
    call.id,
    options.recordApproval === undefined
      ? undefined
      : (event) => options.recordApproval?.(call, event),
  );
}

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  installCoreTools(registry);
  return registry;
}

export function installCoreTools(registry: ToolRegistry): () => void {
  const disposePolicy = registry.onPreExecute(async (execution, next) => {
    if (
      execution.name === "echo"
      && typeof execution.args === "object"
      && execution.args !== null
      && "text" in execution.args
      && String((execution.args as { text: unknown }).text).includes("secret")
    ) {
      return { kind: "deny", reason: "echo text contains secret" };
    }
    return next();
  });
  const disposeEcho = registry.register({
    name: "echo",
    description: "原样返回传入的文本。",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "需要原样返回的文本" },
      },
      required: ["text"],
      additionalProperties: false,
    },
    executionMode: { kind: "parallel" },
    execute(args) {
      if (typeof args !== "object" || args === null || !("text" in args)) {
        throw new Error("echo: expected { text }");
      }
      return String((args as { text: unknown }).text);
    },
  });
  return () => { disposeEcho(); disposePolicy(); };
}

function registerListener<T>(listeners: T[], listener: T): () => void {
  listeners.push(listener);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  };
}

async function waterfall<TListener, TResult>(
  listeners: readonly TListener[],
  invoke: (listener: TListener, next: () => Promise<TResult>) => TResult | Promise<TResult>,
  fallback: () => Promise<TResult>,
): Promise<TResult> {
  const dispatch = async (index: number): Promise<TResult> => {
    const listener = listeners[index];
    if (listener === undefined) return fallback();
    return invoke(listener, () => dispatch(index + 1));
  };
  return dispatch(0);
}

function failure(message: string, code: string): ToolExecutionResult {
  const safe = message.length === 0 ? "tool failed" : message.slice(0, 500);
  return { output: `error: ${safe}`, isError: true, error: { message: safe, code } };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function requestApproval(
  provider: ApprovalProvider | undefined,
  request: ApprovalRequest,
): Promise<ApprovalOutcome> {
  if (request.signal.aborted) return "cancelled";
  if (provider === undefined) return "unavailable";
  try {
    const outcome: unknown = await provider.request(Object.freeze(request));
    if (
      outcome === "allowed-once"
      || outcome === "rejected"
      || outcome === "cancelled"
      || outcome === "unavailable"
    ) return outcome;
    return "unavailable";
  } catch {
    return request.signal.aborted ? "cancelled" : "unavailable";
  }
}

function validateDefinition(definition: ToolDefinition): ToolDefinition {
  const name = definition.name.trim();
  if (name.length === 0 || name !== definition.name) {
    throw new TypeError("tool name must be a non-empty trimmed string");
  }
  if (definition.description.trim().length === 0) {
    throw new TypeError(`tool "${name}" description must not be empty`);
  }
  if (typeof definition.parameters !== "object" || definition.parameters === null) {
    throw new TypeError(`tool "${name}" parameters must be an object`);
  }
  if (typeof definition.execute !== "function") {
    throw new TypeError(`tool "${name}" execute must be a function`);
  }
  if (
    definition.timeoutMs !== undefined
    && (!Number.isFinite(definition.timeoutMs) || definition.timeoutMs <= 0)
  ) {
    throw new TypeError(`tool "${name}" timeoutMs must be a positive finite number`);
  }
  if (
    definition.executionMode.kind !== "parallel"
    && definition.executionMode.kind !== "exclusive"
  ) {
    throw new TypeError(`tool "${name}" has an invalid executionMode`);
  }
  return Object.freeze({
    name,
    description: definition.description,
    parameters: structuredClone(definition.parameters),
    executionMode: Object.freeze({ ...definition.executionMode }),
    ...(definition.timeoutMs === undefined ? {} : { timeoutMs: definition.timeoutMs }),
    execute: definition.execute,
  });
}
