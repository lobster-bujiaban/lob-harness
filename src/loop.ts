import type { LlmClient, LlmReply, LlmStreamChunk } from "./llm.ts";
import { HarnessError, normalizeFailure, throwIfAborted, type Failure } from "./errors.ts";
import {
  deriveLifecycle,
  projectMessages,
  type SessionEvent,
} from "./session.ts";
import { executeToolBatch, type ToolRegistry } from "./tools.ts";
import { defaultToolRegistry } from "./default-tools.ts";
import { persistenceForPath, type SessionPersistence } from "./session-persistence.ts";
import { sessionStoreFor } from "./session-store.ts";
import { fitContext, type ContextBudget } from "./context.ts";
import { emptySystemPromptRegistry, withInstructionText, withStepBudget, type SystemPromptProvider } from "./system-prompt.ts";
import { loadAgentInstructions, sessionWorkspaceRoot } from "./agent-instructions.ts";

export type PreStepDecision =
  | { kind: "reject" }
  | { kind: "enter"; messages: string[] };

export type PreStepPayload = {
  messages: readonly string[];
  turn: number;
  step: number;
  signal: AbortSignal;
};

export type PreStep = (
  payload: PreStepPayload,
) => PreStepDecision | Promise<PreStepDecision>;

export type RequestErrorAction = { kind: "retry" } | undefined;
export type RequestErrorPayload = {
  failure: Failure;
  turn: number;
  step: number;
  attempt: number;
  signal: AbortSignal;
};
export type RequestError = (
  payload: RequestErrorPayload,
) => RequestErrorAction | Promise<RequestErrorAction>;

export type RunTurnOptions = {
  maxSteps?: number;
  onEvent?: (event: SessionEvent) => void | Promise<void>;
  initialUserTexts?: string[];
  claimInitial?: (turn: number) => Promise<string[]>;
  claimNextStep?: (turn: number) => Promise<string[]>;
  preStep?: PreStep;
  requestError?: RequestError;
  signal?: AbortSignal;
  toolRegistry?: ToolRegistry;
  maxToolConcurrency?: number;
  persistence?: SessionPersistence;
  systemPrompts?: SystemPromptProvider;
  contextBudget?: ContextBudget;
};

export const DEFAULT_MAX_STEPS = 100;

export async function runTurn(
  path: string,
  llm: LlmClient,
  userText: string,
  options?: RunTurnOptions,
): Promise<void> {
  const maxSteps = options?.maxSteps ?? DEFAULT_MAX_STEPS;
  const signal = options?.signal ?? new AbortController().signal;
  const toolRegistry = options?.toolRegistry ?? defaultToolRegistry;
  const maxToolConcurrency = options?.maxToolConcurrency ?? 4;
  const unresolvedTarget = options?.persistence === undefined
    ? persistenceForPath(path)
    : { persistence: options.persistence, id: path };
  const target = { ...unresolvedTarget, persistence: sessionStoreFor(unresolvedTarget.persistence) };
  const record = async (event: SessionEvent): Promise<void> => {
    await target.persistence.append(target.id, event);
    try {
      await options?.onEvent?.(event);
    } catch {
      // 持久日志已经提交；观察者失败不能撕开 turn/step 边界。
    }
  };
  const existing = await loadOrEmpty(target.persistence, target.id);
  const turn = deriveLifecycle(existing).lastTurn + 1;
  let openStep: number | undefined;
  let pendingUserTexts = options?.initialUserTexts ?? [userText];
  await record({ type: "turn_start", turn });

  try {
    throwIfAborted(signal);
    if (options?.claimInitial !== undefined) {
      pendingUserTexts = await options.claimInitial(turn);
    }
    for (let index = 0; index < maxSteps; index++) {
      const step = index + 1;
      throwIfAborted(signal);
      const decision = await options?.preStep?.({
        messages: pendingUserTexts,
        turn,
        step,
        signal,
      }) ?? { kind: "enter", messages: pendingUserTexts };
      if (decision.kind === "reject") {
        await record({ type: "turn_end", turn, reason: { kind: "blocked" } });
        return;
      }
      pendingUserTexts = [...decision.messages];
      // 与 DSH 一致：首次提案被改写为空仍保留 turn，但不消费 step。
      if (index === 0 && pendingUserTexts.length === 0) {
        await record({ type: "turn_end", turn, reason: { kind: "completed" } });
        return;
      }
      openStep = step;
      await record({ type: "step_start", turn, step });
      for (const text of pendingUserTexts) await record({ type: "user", text });
      pendingUserTexts = [];

      const basePrompts = options?.systemPrompts ?? emptySystemPromptRegistry;
      const remaining = maxSteps - index;
      const reply = await request(target.id, llm, record, {
        turn,
        step,
        signal,
        requestError: options?.requestError,
        toolRegistry,
        persistence: target.persistence,
        systemPrompts: withStepBudget(basePrompts, { remaining, maxSteps }),
        contextBudget: options?.contextBudget,
      });
      if (reply.kind === "text") {
        await record({ type: "assistant", text: reply.text });
        await record({ type: "step_end", turn, step });
        openStep = undefined;
        pendingUserTexts = await options?.claimNextStep?.(turn) ?? [];
        if (pendingUserTexts.length > 0) continue;
        await record({ type: "turn_end", turn, reason: { kind: "completed" } });
        return;
      }
      for (const call of reply.calls) {
        await record({
          type: "tool_call",
          id: call.id,
          name: call.name,
          args: call.args,
        });
      }
      const toolResults = await executeToolBatch(toolRegistry, reply.calls, {
        signal,
        maxConcurrency: maxToolConcurrency,
        recordApproval: async (_call, approval) => {
            if (approval.type === "asked") {
              await record({
                type: "approval_asked",
                id: approval.id,
                callId: approval.callId,
                toolName: approval.toolName,
                ...(approval.reason === undefined ? {} : { reason: approval.reason }),
              });
            } else {
              await record({
                type: "approval_decided",
                id: approval.id,
                outcome: approval.outcome,
              });
            }
          },
      });
      for (let callIndex = 0; callIndex < reply.calls.length; callIndex++) {
        const call = reply.calls[callIndex];
        const result = toolResults[callIndex];
        if (call === undefined || result === undefined) {
          throw new Error("tool scheduler returned an incomplete result batch");
        }
        await record({
          type: "tool_result",
          id: call.id,
          name: call.name,
          output: result.output,
          ...(result.isError ? { isError: true, error: result.error } : {}),
        });
      }
      if (index === maxSteps - 1) {
        const closing = await request(target.id, llm, record, {
          turn,
          step,
          signal,
          requestError: options?.requestError,
          toolRegistry,
          persistence: target.persistence,
          systemPrompts: withStepBudget(basePrompts, { remaining: 0, maxSteps, closing: true }),
          contextBudget: options?.contextBudget,
        });
        if (closing.kind === "text") {
          await record({ type: "assistant", text: closing.text });
          await record({ type: "step_end", turn, step });
          openStep = undefined;
          pendingUserTexts = await options?.claimNextStep?.(turn) ?? [];
          if (pendingUserTexts.length > 0) continue;
          await record({ type: "turn_end", turn, reason: { kind: "completed" } });
          return;
        }
      }
      await record({ type: "step_end", turn, step });
      openStep = undefined;
      pendingUserTexts = await options?.claimNextStep?.(turn) ?? [];
    }

    await record({ type: "end", reason: "max_steps" });
    await record({ type: "turn_end", turn, reason: { kind: "max_steps" } });
  } catch (error) {
    if (openStep !== undefined) {
      await record({ type: "step_end", turn, step: openStep });
    }
    const failure = normalizeFailure(error, signal);
    const reason = failure.code === "ABORTED"
      ? { kind: "aborted" as const, reason: cancelCause(signal) }
      : { kind: "error" as const, error: failure };
    await record({ type: "turn_end", turn, reason });
    throw error;
  }
}

async function loadOrEmpty(persistence: SessionPersistence, id: string): Promise<SessionEvent[]> {
  try {
    return await persistence.load(id);
  } catch (error) {
    if (
      typeof error === "object" && error !== null && "code" in error
      && (error as { code?: unknown }).code === "ENOENT"
    ) return [];
    throw error;
  }
}

async function complete(
  path: string,
  llm: LlmClient,
  record: (event: SessionEvent) => Promise<void>,
  signal: AbortSignal | undefined,
  toolRegistry: ToolRegistry = defaultToolRegistry,
  persistence: SessionPersistence,
  systemPrompts: SystemPromptProvider,
  contextBudget?: ContextBudget,
): Promise<LlmReply> {
  throwIfAborted(signal);
  const events = await persistence.load(path);
  let conversation = projectMessages(events);
  const tools = toolRegistry.schemas();
  const workspaceRoot = sessionWorkspaceRoot(events);
  const instructions = workspaceRoot === undefined ? "" : await loadAgentInstructions(workspaceRoot);
  const prompts = withInstructionText(systemPrompts, instructions);
  const system = prompts.messages();
  const compaction = fitContext(conversation, system, tools, contextBudget);
  if (compaction !== undefined) {
    const last = events.at(-1) as (SessionEvent & { seq?: number }) | undefined;
    await record({
      type: "context_compacted",
      throughSeq: last?.seq ?? events.length,
      ...compaction,
    });
    conversation = compaction.messages;
  }
  const messages = [...system, ...conversation];
  if (llm.stream === undefined) return llm.complete(messages, tools, signal);
  return consumeStream(llm.stream(messages, tools, signal), record, signal);
}

async function request(
  path: string,
  llm: LlmClient,
  record: (event: SessionEvent) => Promise<void>,
  options: {
    turn: number;
    step: number;
    signal: AbortSignal;
    requestError?: RequestError;
    toolRegistry: ToolRegistry;
    persistence: SessionPersistence;
    systemPrompts: SystemPromptProvider;
    contextBudget?: ContextBudget;
  },
): Promise<LlmReply> {
  for (let attempt = 1; ; attempt++) {
    throwIfAborted(options.signal);
    await record({
      type: "request_start",
      turn: options.turn,
      step: options.step,
      attempt,
    });
    try {
      const reply = await complete(
        path,
        llm,
        record,
        options.signal,
        options.toolRegistry,
        options.persistence,
        options.systemPrompts,
        options.contextBudget,
      );
      await record({
        type: "request_end",
        turn: options.turn,
        step: options.step,
        attempt,
        reason: { kind: "completed" },
      });
      return reply;
    } catch (error) {
      const failure = normalizeFailure(error, options.signal);
      await record({
        type: "request_end",
        turn: options.turn,
        step: options.step,
        attempt,
        reason: { kind: "error", error: failure },
      });
      if (failure.code !== "ABORTED") {
        const action = await options.requestError?.({
          failure,
          turn: options.turn,
          step: options.step,
          attempt,
          signal: options.signal,
        });
        throwIfAborted(options.signal);
        if (action?.kind === "retry") continue;
      }
      throw new HarnessError(failure.message, failure.code, { cause: error });
    }
  }
}

async function consumeStream(
  stream: AsyncIterable<LlmStreamChunk>,
  record: (event: SessionEvent) => Promise<void>,
  signal?: AbortSignal,
): Promise<LlmReply> {
  let text = "";
  let finish: "stop" | "tool_calls" | "length" | undefined;
  const calls = new Map<number, { id: string; name: string; arguments: string }>();

  for await (const chunk of stream) {
    throwIfAborted(signal);
    switch (chunk.type) {
      case "text_delta":
        text += chunk.text;
        await record({ type: "assistant_chunk", kind: "text", text: chunk.text });
        break;
      case "reasoning_delta":
        await record({ type: "assistant_chunk", kind: "reasoning", text: chunk.text });
        break;
      case "tool_call_delta": {
        const current = calls.get(chunk.index) ?? { id: "", name: "", arguments: "" };
        if (chunk.id !== undefined) current.id = chunk.id;
        if (chunk.name !== undefined) current.name = chunk.name;
        current.arguments += chunk.argumentsDelta;
        calls.set(chunk.index, current);
        await record({
          type: "assistant_chunk",
          kind: "tool_call",
          index: chunk.index,
          ...(chunk.id !== undefined ? { id: chunk.id } : {}),
          ...(chunk.name !== undefined ? { name: chunk.name } : {}),
          argumentsDelta: chunk.argumentsDelta,
        });
        break;
      }
      case "usage":
        await record({ type: "usage", ...chunk.usage });
        break;
      case "finish":
        finish = chunk.reason;
        break;
    }
  }

  if (finish === "length") throw new Error("model stream reached its token limit");
  if (calls.size > 0 || finish === "tool_calls") {
    const parsed = [...calls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => {
        if (call.id.length === 0 || call.name.length === 0) {
          throw new Error("model stream returned an incomplete tool call");
        }
        try {
          return { id: call.id, name: call.name, args: JSON.parse(call.arguments) as unknown };
        } catch (error) {
          throw new Error(`model stream returned invalid arguments for tool "${call.name}"`, {
            cause: error,
          });
        }
      });
    if (parsed.length === 0) throw new Error("model finished with tool_calls but returned no call");
    return { kind: "tool", calls: parsed };
  }
  if (text.length === 0) throw new Error("model stream returned no visible text");
  return { kind: "text", text };
}

function cancelCause(signal?: AbortSignal): import("./session.ts").AgentCancelCause {
  const reason = signal?.reason;
  if (
    typeof reason === "object" && reason !== null && "kind" in reason
    && ((reason as { kind?: unknown }).kind === "user"
      || (reason as { kind?: unknown }).kind === "shutdown")
  ) return reason as import("./session.ts").AgentCancelCause;
  return { kind: "user" };
}
