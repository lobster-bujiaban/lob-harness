import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { FakeLlm } from "../src/llm.ts";
import { runTurn } from "../src/loop.ts";
import { load } from "../src/session.ts";

async function sessionPath() {
  const dir = await mkdtemp(join(tmpdir(), "tiny-harness-"));
  return join(dir, "session.jsonl");
}

test("连续两次 echo 后再给文本，正常结束", async () => {
  const path = await sessionPath();
  const llm = new FakeLlm([
    { kind: "tool", calls: [{ id: "1", name: "echo", args: { text: "one" } }] },
    { kind: "tool", calls: [{ id: "2", name: "echo", args: { text: "two" } }] },
    { kind: "text", text: "两次 echo 都完成了" },
  ]);

  await runTurn(path, llm, "echo 两次");

  expect((await load(path)).map((event) => event.type)).toEqual([
    "turn_start", "step_start",
    "user",
    "request_start", "request_end",
    "tool_call",
    "tool_result",
    "step_end", "step_start",
    "request_start", "request_end",
    "tool_call",
    "tool_result",
    "step_end", "step_start",
    "request_start", "request_end",
    "assistant",
    "step_end", "turn_end",
  ]);
});

test("maxSteps=1 时第一次工具后若收尾仍要调工具，则截断", async () => {
  const path = await sessionPath();
  const llm = new FakeLlm([
    { kind: "tool", calls: [{ id: "1", name: "echo", args: { text: "one" } }] },
    { kind: "tool", calls: [{ id: "2", name: "echo", args: { text: "two" } }] },
    { kind: "text", text: "不应该走到这里" },
  ]);

  await runTurn(path, llm, "echo 两次", { maxSteps: 1 });

  const events = await load(path);
  expect(events.map((event) => event.type)).toEqual([
    "turn_start", "step_start",
    "user",
    "request_start", "request_end",
    "tool_call",
    "tool_result",
    "request_start", "request_end",
    "step_end",
    "end",
    "turn_end",
  ]);
  expect(events.at(-2)).toEqual({ type: "end", reason: "max_steps" });
  expect(events.at(-1)).toEqual({
    type: "turn_end",
    turn: 1,
    reason: { kind: "max_steps" },
  });
});

test("maxSteps=1 时工具执行完后允许一次结论文本", async () => {
  const path = await sessionPath();
  const llm = new FakeLlm([
    { kind: "tool", calls: [{ id: "1", name: "echo", args: { text: "one" } }] },
    { kind: "text", text: "已经改完" },
  ]);

  await runTurn(path, llm, "echo 一次", { maxSteps: 1 });

  const events = await load(path);
  expect(events.map((event) => event.type)).toEqual([
    "turn_start", "step_start",
    "user",
    "request_start", "request_end",
    "tool_call",
    "tool_result",
    "request_start", "request_end",
    "assistant",
    "step_end",
    "turn_end",
  ]);
  expect(events.at(-1)).toEqual({
    type: "turn_end",
    turn: 1,
    reason: { kind: "completed" },
  });
});

test("同一次回复的多个工具调用先完整记录，再按顺序记录结果", async () => {
  const path = await sessionPath();
  const llm = new FakeLlm([
    {
      kind: "tool",
      calls: [
        { id: "1", name: "echo", args: { text: "one" } },
        { id: "2", name: "echo", args: { text: "two" } },
      ],
    },
    { kind: "text", text: "完成" },
  ]);

  await runTurn(path, llm, "echo 两次");

  expect((await load(path)).map((event) => event.type)).toEqual([
    "turn_start", "step_start",
    "user",
    "request_start", "request_end",
    "tool_call",
    "tool_call",
    "tool_result",
    "tool_result",
    "step_end", "step_start",
    "request_start", "request_end",
    "assistant",
    "step_end", "turn_end",
  ]);
});
