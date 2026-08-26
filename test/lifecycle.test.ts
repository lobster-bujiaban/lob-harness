import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { LlmClient } from "../src/llm.ts";
import { FakeLlm } from "../src/llm.ts";
import { runTurn } from "../src/loop.ts";
import { append, deriveLifecycle, load } from "../src/session.ts";
import { HarnessError } from "../src/errors.ts";
import { createRetryPolicy, type RetryClock } from "../src/retry.ts";

async function sessionPath() {
  const dir = await mkdtemp(join(tmpdir(), "tiny-harness-lifecycle-"));
  return join(dir, "session.jsonl");
}

test("一个工具调用产生两个 step，但只属于同一个 turn", async () => {
  const path = await sessionPath();
  const llm = new FakeLlm([
    { kind: "tool", calls: [{ id: "1", name: "echo", args: { text: "hi" } }] },
    { kind: "text", text: "完成" },
  ]);

  await runTurn(path, llm, "echo hi");

  const events = await load(path);
  expect(events.filter((event) => event.type.startsWith("turn_"))).toEqual([
    { type: "turn_start", turn: 1 },
    { type: "turn_end", turn: 1, reason: { kind: "completed" } },
  ]);
  expect(events.filter((event) => event.type.startsWith("step_"))).toEqual([
    { type: "step_start", turn: 1, step: 1 },
    { type: "step_end", turn: 1, step: 1 },
    { type: "step_start", turn: 1, step: 2 },
    { type: "step_end", turn: 1, step: 2 },
  ]);
  expect(deriveLifecycle(events)).toEqual({ lastTurn: 1 });
});

test("模型失败时先闭合 step，再以 error 闭合 turn", async () => {
  const path = await sessionPath();
  const llm: LlmClient = {
    async complete() {
      throw new Error("provider unavailable");
    },
  };

  await expect(runTurn(path, llm, "hello")).rejects.toThrow("provider unavailable");

  const events = await load(path);
  expect(events.map((event) => event.type)).toEqual([
    "turn_start",
    "step_start",
    "user",
    "request_start",
    "request_end",
    "step_end",
    "turn_end",
  ]);
  expect(events.at(-1)).toEqual({
    type: "turn_end",
    turn: 1,
    reason: {
      kind: "error",
      error: { message: "provider unavailable", code: "UNKNOWN" },
    },
  });
  expect(deriveLifecycle(events)).toEqual({ lastTurn: 1 });
});

test("重启后从日志恢复 turn 序号，也能识别未闭合边界", async () => {
  const path = await sessionPath();
  await runTurn(path, new FakeLlm([{ kind: "text", text: "one" }]), "one");
  await runTurn(path, new FakeLlm([{ kind: "text", text: "two" }]), "two");
  expect(deriveLifecycle(await load(path))).toEqual({ lastTurn: 2 });

  const interruptedPath = await sessionPath();
  await append(interruptedPath, { type: "turn_start", turn: 7 });
  await append(interruptedPath, { type: "step_start", turn: 7, step: 3 });
  expect(deriveLifecycle(await load(interruptedPath))).toEqual({
    lastTurn: 7,
    openTurn: 7,
    openStep: { turn: 7, step: 3 },
  });
});

test("超时按 TIMEOUT 闭合失败 step 和 turn", async () => {
  const path = await sessionPath();
  const controller = new AbortController();
  const llm: LlmClient = {
    async complete() {
      controller.abort(new DOMException("deadline reached", "TimeoutError"));
      throw controller.signal.reason;
    },
  };

  await expect(runTurn(path, llm, "hello", { signal: controller.signal }))
    .rejects.toThrow("operation timed out");

  const events = await load(path);
  expect(events.map((event) => event.type)).toEqual([
    "turn_start",
    "step_start",
    "user",
    "request_start",
    "request_end",
    "step_end",
    "turn_end",
  ]);
  expect(events.at(-1)).toEqual({
    type: "turn_end",
    turn: 1,
    reason: {
      kind: "error",
      error: { message: "operation timed out", code: "TIMEOUT" },
    },
  });
});

test("requestError 返回 retry 时在同一 step 开启新的持久 request attempt", async () => {
  const path = await sessionPath();
  let calls = 0;
  const llm: LlmClient = {
    async complete() {
      calls += 1;
      if (calls === 1) throw new HarnessError("provider busy", "RATE_LIMITED");
      return { kind: "text", text: "重试成功" };
    },
  };
  const seen: Array<{ attempt: number; code: string }> = [];

  await runTurn(path, llm, "hello", {
    requestError: ({ attempt, failure }) => {
      seen.push({ attempt, code: failure.code });
      return { kind: "retry" };
    },
  });

  expect(calls).toBe(2);
  expect(seen).toEqual([{ attempt: 1, code: "RATE_LIMITED" }]);
  const events = await load(path);
  expect(events.filter((event) => event.type === "request_start")).toEqual([
    { type: "request_start", turn: 1, step: 1, attempt: 1 },
    { type: "request_start", turn: 1, step: 1, attempt: 2 },
  ]);
  expect(events.filter((event) => event.type === "request_end")).toEqual([
    {
      type: "request_end",
      turn: 1,
      step: 1,
      attempt: 1,
      reason: {
        kind: "error",
        error: { message: "provider busy", code: "RATE_LIMITED" },
      },
    },
    {
      type: "request_end",
      turn: 1,
      step: 1,
      attempt: 2,
      reason: { kind: "completed" },
    },
  ]);
  expect(events.filter((event) => event.type === "step_start")).toHaveLength(1);
  expect(events.at(-1)).toEqual({
    type: "turn_end",
    turn: 1,
    reason: { kind: "completed" },
  });
});

test("指数退避按上限增长，注入时钟时不真实等待", async () => {
  const path = await sessionPath();
  const delays: number[] = [];
  const clock: RetryClock = {
    async sleep(delayMs) {
      delays.push(delayMs);
      return true;
    },
  };
  let calls = 0;
  const llm: LlmClient = {
    async complete() {
      calls += 1;
      if (calls <= 3) throw new HarnessError("temporary timeout", "TIMEOUT");
      return { kind: "text", text: "恢复成功" };
    },
  };

  await runTurn(path, llm, "hello", {
    requestError: createRetryPolicy({
      maxRetries: 3,
      initialDelayMs: 100,
      maxDelayMs: 250,
      jitterRatio: 0,
    }, { clock }),
  });

  expect(calls).toBe(4);
  expect(delays).toEqual([100, 200, 250]);
  expect((await load(path)).filter((event) => event.type === "request_start"))
    .toHaveLength(4);
});

test("重试预算耗尽后终止，非白名单错误从不重试", async () => {
  const delays: number[] = [];
  const clock: RetryClock = {
    async sleep(delayMs) {
      delays.push(delayMs);
      return true;
    },
  };
  const policy = createRetryPolicy({
    maxRetries: 2,
    initialDelayMs: 10,
    maxDelayMs: 20,
    jitterRatio: 0,
  }, { clock });

  const retryPath = await sessionPath();
  let retryCalls = 0;
  await expect(runTurn(retryPath, {
    async complete() {
      retryCalls += 1;
      throw new HarnessError("still busy", "RATE_LIMITED");
    },
  }, "retry", { requestError: policy })).rejects.toMatchObject({ code: "RATE_LIMITED" });

  const terminalPath = await sessionPath();
  let terminalCalls = 0;
  await expect(runTurn(terminalPath, {
    async complete() {
      terminalCalls += 1;
      throw new HarnessError("bad request", "UNKNOWN");
    },
  }, "terminal", { requestError: policy })).rejects.toMatchObject({ code: "UNKNOWN" });

  expect(retryCalls).toBe(3);
  expect(terminalCalls).toBe(1);
  expect(delays).toEqual([10, 20]);
  expect((await load(retryPath)).filter((event) => event.type === "request_start"))
    .toHaveLength(3);
});
