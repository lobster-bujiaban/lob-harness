import { appendFile, readFile } from "node:fs/promises";
import type { Failure } from "./errors.ts";
import type { ApprovalOutcome } from "./tools.ts";

export type AgentCancelCause =
  | { kind: "user" }
  | { kind: "shutdown" };

export type SessionEvent =
  | { type: "workspace_root"; path: string }
  | {
      type: "inbox_inserted";
      id: string;
      target: "next_turn" | "next_step";
      text: string;
    }
  | {
      type: "inbox_claimed";
      id: string;
      target: "next_turn" | "next_step";
      text: string;
      turn: number;
    }
  | { type: "turn_start"; turn: number }
  | {
      type: "turn_end";
      turn: number;
      reason:
        | { kind: "completed" }
        | { kind: "blocked" }
        | { kind: "aborted"; reason: AgentCancelCause }
        | { kind: "max_steps" }
        | { kind: "error"; error: Failure };
    }
  | { type: "step_start"; turn: number; step: number }
  | { type: "step_end"; turn: number; step: number }
  | {
      type: "approval_asked";
      id: string;
      callId: string;
      toolName: string;
      reason?: string;
    }
  | { type: "approval_decided"; id: string; outcome: ApprovalOutcome }
  | { type: "request_start"; turn: number; step: number; attempt: number }
  | {
      type: "request_end";
      turn: number;
      step: number;
      attempt: number;
      reason: { kind: "completed" } | { kind: "error"; error: Failure };
    }
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | {
      type: "context_compacted";
      throughSeq: number;
      strategy: "tool_result_prune" | "summary";
      messages: ModelMessage[];
      beforeTokens: number;
      afterTokens: number;
    }
  | { type: "assistant_chunk"; kind: "text" | "reasoning"; text: string }
  | {
      type: "assistant_chunk";
      kind: "tool_call";
      index: number;
      id?: string;
      name?: string;
      argumentsDelta: string;
    }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      reasoningTokens?: number;
    }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | {
      type: "tool_result";
      id: string;
      name: string;
      output: string;
      isError?: true;
      error?: { message: string; code: string };
    }
  | {
      type: "subagent_descriptor";
      parentSessionId: string;
      mode: "continuable";
    }
  | { type: "subagent_started"; childId: string; prompt: string }
  | { type: "subagent_ended"; childId: string; output: string }
  | { type: "job_descriptor"; parentSessionId: string; prompt: string }
  | { type: "job_started"; jobId: string; prompt: string }
  | { type: "job_ended"; jobId: string; status: "completed" | "killed" | "failed"; output: string }
  | {
      type: "goal_change";
      action: "create" | "complete";
      goal: { id: string; revision: number; objective: string; phase: "active" | "completed" };
    }
  | { type: "end"; reason: string };

export type ModelToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ModelMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      reasoning_content?: string;
      tool_calls?: ModelToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export async function append(path: string, event: SessionEvent): Promise<void> {
  await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
}

export async function load(path: string): Promise<SessionEvent[]> {
  const text = await readFile(path, "utf8");
  if (text.length === 0) return [];
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const { seq: _seq, at: _at, ...event } = JSON.parse(line) as SessionEvent & { seq?: number; at?: number };
      return event as SessionEvent;
    });
}

export function projectMessages(events: SessionEvent[]): ModelMessage[] {
  let start = 0;
  let messages: ModelMessage[] = [];
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.type !== "context_compacted") continue;
    messages = structuredClone(event.messages);
    start = index + 1;
    break;
  }
  for (let index = start; index < events.length; index++) {
    const event = events[index];
    if (event === undefined) continue;
    switch (event.type) {
      case "user":
        messages.push({ role: "user", content: event.text });
        break;
      case "assistant":
        {
          const reasoning = precedingChunks(events, index, "reasoning");
          messages.push({
            role: "assistant",
            content: event.text,
            ...(reasoning.length > 0 ? { reasoning_content: reasoning } : {}),
          });
        }
        break;
      case "tool_call":
        {
          const calls: ModelToolCall[] = [];
          let callIndex = index;
          while (events[callIndex]?.type === "tool_call") {
            const call = events[callIndex];
            if (call?.type !== "tool_call") break;
            calls.push({
              id: call.id,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.args),
              },
            });
            callIndex += 1;
          }
          const reasoning = precedingChunks(events, index, "reasoning");
          const text = precedingChunks(events, index, "text");
          messages.push({
            role: "assistant",
            content: text,
            ...(reasoning.length > 0 ? { reasoning_content: reasoning } : {}),
            tool_calls: calls,
          });
          index = callIndex - 1;
        }
        break;
      case "tool_result":
        messages.push({
          role: "tool",
          tool_call_id: event.id,
          content: event.output || "(no output)",
        });
        break;
      case "end":
      case "turn_start":
      case "turn_end":
      case "step_start":
      case "step_end":
      case "approval_asked":
      case "approval_decided":
      case "request_start":
      case "request_end":
      case "inbox_inserted":
      case "inbox_claimed":
      case "workspace_root":
      case "assistant_chunk":
      case "usage":
      case "context_compacted":
      case "subagent_descriptor":
      case "subagent_started":
      case "subagent_ended":
      case "job_descriptor":
      case "job_started":
      case "job_ended":
      case "goal_change":
        break;
    }
  }
  return messages;
}

export function deriveWorkspaceRoot(
  events: SessionEvent[],
  fallback = process.cwd(),
): string {
  let root = fallback;
  for (const event of events) {
    if (event.type === "workspace_root") root = event.path;
  }
  return root;
}

export type InboxItem = {
  id: string;
  target: "next_turn" | "next_step";
  text: string;
};

/** 从持久事件重建尚未被领取的 inbox。 */
export function deriveInbox(events: SessionEvent[]): {
  nextTurn: InboxItem[];
  nextStep: InboxItem[];
} {
  const pending = new Map<string, InboxItem>();
  for (const event of events) {
    if (event.type === "inbox_inserted") {
      pending.set(event.id, {
        id: event.id,
        target: event.target,
        text: event.text,
      });
    } else if (event.type === "inbox_claimed") {
      pending.delete(event.id);
    }
  }
  const values = [...pending.values()];
  return {
    nextTurn: values.filter((item) => item.target === "next_turn"),
    nextStep: values.filter((item) => item.target === "next_step"),
  };
}

export type SessionLifecycle = {
  lastTurn: number;
  openTurn?: number;
  openStep?: { turn: number; step: number };
};

/** 从持久日志重建生命周期边界，供恢复和诊断使用。 */
export function deriveLifecycle(events: SessionEvent[]): SessionLifecycle {
  let lastTurn = 0;
  let openTurn: number | undefined;
  let openStep: { turn: number; step: number } | undefined;
  for (const event of events) {
    if (event.type === "turn_start") {
      lastTurn = Math.max(lastTurn, event.turn);
      openTurn = event.turn;
      openStep = undefined;
    } else if (event.type === "step_start") {
      openStep = { turn: event.turn, step: event.step };
    } else if (event.type === "step_end") {
      if (openStep?.turn === event.turn && openStep.step === event.step) {
        openStep = undefined;
      }
    } else if (event.type === "turn_end") {
      if (openTurn === event.turn) openTurn = undefined;
      openStep = undefined;
    }
  }
  return {
    lastTurn,
    ...(openTurn === undefined ? {} : { openTurn }),
    ...(openStep === undefined ? {} : { openStep }),
  };
}

function precedingChunks(
  events: SessionEvent[],
  index: number,
  kind: "text" | "reasoning",
): string {
  const parts: string[] = [];
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const event = events[cursor];
    if (event?.type === "usage" || event?.type === "request_end") continue;
    if (event?.type !== "assistant_chunk") break;
    if (event.kind === kind) parts.unshift(event.text);
  }
  return parts.join("");
}
