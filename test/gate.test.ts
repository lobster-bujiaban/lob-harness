import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { FakeLlm } from "../src/llm.ts";
import { runTurn } from "../src/loop.ts";
import { load } from "../src/session.ts";

test("text 含 secret 则拒绝，拒绝结果在日志里", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tiny-harness-"));
  const path = join(dir, "session.jsonl");
  const llm = new FakeLlm([
    {
      kind: "tool",
      calls: [{ id: "1", name: "echo", args: { text: "leak secret" } }],
    },
    { kind: "text", text: "刚才的调用被拒绝了" },
  ]);

  await runTurn(path, llm, "用 echo 说 secret");

  const events = await load(path);
  expect(events.map((event) => event.type)).toEqual([
    "turn_start",
    "step_start",
    "user",
    "request_start",
    "request_end",
    "tool_call",
    "tool_result",
    "step_end",
    "step_start",
    "request_start",
    "request_end",
    "assistant",
    "step_end",
    "turn_end",
  ]);
  const result = events.find((event) => event.type === "tool_result");
  expect(result).toMatchObject({
    type: "tool_result",
    id: "1",
    name: "echo",
  });
  expect(String(result && "output" in result ? result.output : "")).toContain(
    "denied",
  );
  expect(result).toMatchObject({
    isError: true,
    error: { code: "DENIED" },
  });
});

test("loop 代码没有 secret 字样", async () => {
  const loopPath = join(dirname(fileURLToPath(import.meta.url)), "../src/loop.ts");
  const src = await readFile(loopPath, "utf8");
  expect(src.includes("secret")).toBe(false);
  expect(src).toContain("executeToolBatch(toolRegistry");
  expect(src.includes('call.name === "echo"')).toBe(false);
});
