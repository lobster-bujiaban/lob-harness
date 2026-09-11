import { HarnessError } from "./errors.ts";
import type { ToolSchema } from "./llm.ts";
import type { ModelMessage } from "./session.ts";

export interface TokenMeter {
  count(messages: readonly ModelMessage[], tools: readonly ToolSchema[]): number;
}

/** 与 DSH 相同思路的固定密度启发式：约 4 chars/token，并计入消息与工具结构开销。 */
export class CharacterTokenMeter implements TokenMeter {
  count(messages: readonly ModelMessage[], tools: readonly ToolSchema[]): number {
    const messageTokens = messages.reduce((sum, message) => {
      const structure = message.role === "assistant" && message.tool_calls !== undefined
        ? JSON.stringify(message.tool_calls).length
        : message.role === "tool" ? message.tool_call_id.length : 0;
      return sum + Math.ceil((message.content.length + structure) / 4) + 4;
    }, 0);
    return messageTokens + (tools.length === 0 ? 0 : Math.ceil(JSON.stringify(tools).length / 4) + 4);
  }
}

export type ContextBudget = {
  maxInputTokens: number;
  meter: TokenMeter;
  preserveRecent?: number;
};

export type ContextCompaction = {
  strategy: "tool_result_prune" | "summary";
  messages: ModelMessage[];
  beforeTokens: number;
  afterTokens: number;
};

export function fitContext(
  conversation: ModelMessage[],
  system: ModelMessage[],
  tools: ToolSchema[],
  budget?: ContextBudget,
): ContextCompaction | undefined {
  if (budget === undefined || !Number.isFinite(budget.maxInputTokens)) return undefined;
  if (budget.maxInputTokens <= 0) throw new Error("context maxInputTokens must be positive");
  const count = (messages: ModelMessage[]) => budget.meter.count([...system, ...messages], tools);
  const beforeTokens = count(conversation);
  if (beforeTokens <= budget.maxInputTokens) return undefined;

  const pruned = pruneToolResults(conversation);
  const prunedTokens = count(pruned);
  if (prunedTokens < beforeTokens && prunedTokens <= budget.maxInputTokens) {
    return { strategy: "tool_result_prune", messages: pruned, beforeTokens, afterTokens: prunedTokens };
  }

  const summarized = summarizeMessages(pruned, budget.preserveRecent ?? 4);
  const summarizedTokens = count(summarized);
  if (summarizedTokens >= Math.min(beforeTokens, prunedTokens) || summarizedTokens > budget.maxInputTokens) {
    throw new HarnessError("context compaction made no sufficient progress", "CONTEXT_WINDOW_EXCEEDED");
  }
  return { strategy: "summary", messages: summarized, beforeTokens, afterTokens: summarizedTokens };
}

export function pruneToolResults(messages: ModelMessage[]): ModelMessage[] {
  const thresholdChars = 8192;
  const headChars = 4096;
  const tailChars = 1024;
  const marker = "\n\n[... tool result middle pruned ...]\n\n";
  return messages.map((message) => message.role === "tool" && message.content.length > thresholdChars
    ? {
        ...message,
        content: message.content.slice(0, headChars) + marker + message.content.slice(-tailChars),
      }
    : structuredClone(message));
}

export function summarizeMessages(messages: ModelMessage[], preserveRecent = 4): ModelMessage[] {
  let split = Math.max(0, messages.length - Math.max(1, preserveRecent));
  while (split > 0 && messages[split]?.role === "tool") split -= 1;
  if (split === 0) return structuredClone(messages);
  const older = messages.slice(0, split);
  const summary = older.map((message) => {
    const label = message.role === "tool" ? `tool:${message.tool_call_id}` : message.role;
    return `${label}: ${message.content.replace(/\s+/gu, " ").slice(0, 100)}`;
  }).join("\n");
  return [
    { role: "system", content: `Conversation summary:\n${summary}` },
    ...structuredClone(messages.slice(split)),
  ];
}
