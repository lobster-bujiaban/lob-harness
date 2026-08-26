import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { FakeLlm } from "../src/llm.ts";
import { runTurn } from "../src/loop.ts";
import { append, load, projectMessages, type ModelMessage } from "../src/session.ts";
import { CharacterTokenMeter } from "../src/context.ts";
import { SystemPromptRegistry } from "../src/system-prompt.ts";
import { createDefaultToolRegistry } from "../src/tools.ts";

test("输入你好后，日志是 user + assistant，最后一条是假模型的固定回复", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tiny-harness-"));
  const path = join(dir, "session.jsonl");
  const llm = new FakeLlm([{ kind: "text", text: "你好，我是假模型" }]);

  await runTurn(path, llm, "你好");

  const events = await load(path);
  expect(events).toEqual([
    { type: "turn_start", turn: 1 },
    { type: "step_start", turn: 1, step: 1 },
    { type: "user", text: "你好" },
    { type: "request_start", turn: 1, step: 1, attempt: 1 },
    {
      type: "request_end",
      turn: 1,
      step: 1,
      attempt: 1,
      reason: { kind: "completed" },
    },
    { type: "assistant", text: "你好，我是假模型" },
    { type: "step_end", turn: 1, step: 1 },
    { type: "turn_end", turn: 1, reason: { kind: "completed" } },
  ]);
  expect(projectMessages(events).at(-1)).toEqual({
    role: "assistant",
    content: "你好，我是假模型",
  });
});

test("每次请求重新组装 System Prompt，撤销后立即生效", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tiny-harness-prompt-"));
  const path = join(dir, "session.jsonl");
  const prompts = new SystemPromptRegistry();
  const dispose = prompts.register({ id: "identity", text: "You are concise." });
  const firstRequests: ModelMessage[][] = [];
  const first = { async complete(messages: ModelMessage[]) { firstRequests.push(messages); return { kind: "text" as const, text: "one" }; } };
  await runTurn(path, first, "first", { systemPrompts: prompts });
  expect(firstRequests[0]?.[0]).toEqual({ role: "system", content: "You are concise." });

  dispose();
  const secondRequests: ModelMessage[][] = [];
  const second = { async complete(messages: ModelMessage[]) { secondRequests.push(messages); return { kind: "text" as const, text: "two" }; } };
  await runTurn(path, second, "second", { systemPrompts: prompts });
  expect(secondRequests[0]?.some((message) => message.role === "system")).toBe(false);
  expect((await load(path)).some((event) => event.type === "context_compacted")).toBe(false);
});

test("超预算时持久化压缩事件并用压缩后的 surface 请求模型", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tiny-harness-context-"));
  const path = join(dir, "session.jsonl");
  for (let index = 0; index < 8; index++) {
    await append(path, { type: "user", text: `${index}:${"x".repeat(300)}` });
  }
  const requests: ModelMessage[][] = [];
  const llm = { async complete(messages: ModelMessage[]) { requests.push(messages); return { kind: "text" as const, text: "done" }; } };
  await runTurn(path, llm, "next", {
    contextBudget: { maxInputTokens: 400, meter: new CharacterTokenMeter(), preserveRecent: 1 },
    toolRegistry: createDefaultToolRegistry(),
  });
  const compacted = (await load(path)).find((event) => event.type === "context_compacted");
  expect(compacted).toMatchObject({ type: "context_compacted", strategy: "summary" });
  expect(requests[0]?.[0]).toMatchObject({ role: "system" });
  expect(requests[0]?.[0]?.content).toContain("Conversation summary");
});

test("压缩无进展时通过 requestError 暴露 CONTEXT_WINDOW_EXCEEDED 且不循环", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tiny-harness-overflow-"));
  const path = join(dir, "session.jsonl");
  const failures: string[] = [];
  const llm = new FakeLlm([{ kind: "text", text: "unreachable" }]);
  await expect(runTurn(path, llm, "x".repeat(1000), {
    contextBudget: { maxInputTokens: 100, meter: new CharacterTokenMeter() },
    requestError({ failure }) {
      failures.push(failure.code);
      return undefined;
    },
  })).rejects.toMatchObject({ code: "CONTEXT_WINDOW_EXCEEDED" });
  expect(failures).toEqual(["CONTEXT_WINDOW_EXCEEDED"]);
  expect((await load(path)).filter((event) => event.type === "request_start")).toHaveLength(1);
});
