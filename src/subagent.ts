import { ToolError, type ToolRegistry } from "./tools.ts";
import type { SessionEvent } from "./session.ts";
import { throwIfAborted } from "./errors.ts";

export type SubagentOwner = {
  source: string;
  sessionId: string;
  workspaceRoot: string;
};

export type SubagentStartRequest = {
  parentSessionId: string;
  source: string;
  workspaceRoot: string;
  prompt: string;
  signal: AbortSignal;
};

export type SubagentFollowupRequest = SubagentStartRequest & {
  childId: string;
};

export type SubagentRunResult = {
  childId: string;
  output: string;
  continued: boolean;
};

export interface SubagentRuntime {
  start(request: SubagentStartRequest): Promise<SubagentRunResult>;
  followup(request: SubagentFollowupRequest): Promise<SubagentRunResult>;
}

export function lastAssistantOutput(events: readonly SessionEvent[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "assistant" && event.text.trim().length > 0) return event.text;
  }
  return "";
}

export function subagentDescriptorOf(events: readonly SessionEvent[]): Extract<SessionEvent, { type: "subagent_descriptor" }> | undefined {
  return events.find((event) => event.type === "subagent_descriptor");
}

export function renderSubagentResult(result: SubagentRunResult): string {
  const header = result.continued
    ? `continued subagent ${result.childId}`
    : `started subagent ${result.childId}`;
  const body = result.output.trim().length === 0 ? "(no output)" : result.output;
  return `${header}\n${body}`;
}

export function installSubagent(
  registry: ToolRegistry,
  options: { subagents: SubagentRuntime; owner: SubagentOwner },
): () => void {
  return registry.register({
    name: "subagent",
    description: "把任务委派给可继续的子 Agent。省略 childId 时新建独立会话；传入上次返回的 childId 则在同一子会话继续。子级中间步骤不会进入父级日志。",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "交给子 Agent 的任务" },
        childId: { type: "string", description: "已有子会话 id，用于继续" },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    executionMode: { kind: "exclusive" },
    timeoutMs: 120_000,
    async execute(args, context) {
      throwIfAborted(context.signal);
      const prompt = parsePrompt(args);
      const childId = parseChildId(args);
      const request = {
        parentSessionId: options.owner.sessionId,
        source: options.owner.source,
        workspaceRoot: options.owner.workspaceRoot,
        prompt,
        signal: context.signal,
      };
      const result = childId === undefined
        ? await options.subagents.start(request)
        : await options.subagents.followup({ ...request, childId });
      return renderSubagentResult(result);
    },
  });
}

function parsePrompt(args: unknown): string {
  if (typeof args !== "object" || args === null || !("prompt" in args)) {
    throw new ToolError("subagent prompt required", "SUBAGENT_INVALID_ARGS");
  }
  const prompt = String((args as { prompt: unknown }).prompt).trim();
  if (prompt.length === 0) throw new ToolError("subagent prompt required", "SUBAGENT_INVALID_ARGS");
  return prompt;
}

function parseChildId(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null || !("childId" in args) || (args as { childId?: unknown }).childId === undefined) {
    return undefined;
  }
  const childId = String((args as { childId: unknown }).childId).trim();
  if (childId.length === 0) throw new ToolError("subagent childId 无效", "SUBAGENT_INVALID_ARGS");
  return childId;
}
