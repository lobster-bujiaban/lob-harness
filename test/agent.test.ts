import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { Agent, type AgentStatus } from "../src/agent.ts";
import type { LlmClient, LlmReply, ToolSchema } from "../src/llm.ts";
import type { ModelMessage } from "../src/session.ts";
import { deriveInbox, load } from "../src/session.ts";
import { createRetryPolicy, type RetryClock } from "../src/retry.ts";
import { HarnessError } from "../src/errors.ts";

async function sessionPath() {
  const dir = await mkdtemp(join(tmpdir(), "tiny-harness-agent-"));
  return join(dir, "session.jsonl");
}

class ScriptedLlm implements LlmClient {
  readonly requests: ModelMessage[][] = [];

  constructor(
    private readonly replies: Array<LlmReply | Promise<LlmReply>>,
    private readonly onRequest?: () => void,
  ) {}

  async complete(messages: ModelMessage[], _tools: ToolSchema[]): Promise<LlmReply> {
    this.requests.push(structuredClone(messages));
    this.onRequest?.();
    const reply = this.replies.shift();
    if (reply === undefined) throw new Error("missing scripted reply");
    return reply;
  }
}

test("idle inject 只入 next-step，不唤醒 Agent", async () => {
  const path = await sessionPath();
  const llm = new ScriptedLlm([{ kind: "text", text: "unused" }]);
  const agent = new Agent(path, () => llm);

  await agent.inject("背景信息");
  await agent.whenIdle();

  expect(agent.status).toBe("idle");
  expect(agent.inbox.nextStep.map((item) => item.text)).toEqual(["背景信息"]);
  expect((await load(path)).map((event) => event.type)).toEqual(["inbox_inserted"]);
});

test("followup 唤醒 Agent，并在 turn 开始后领取 idle inject", async () => {
  const path = await sessionPath();
  const llm = new ScriptedLlm([{ kind: "text", text: "完成" }]);
  const statuses: AgentStatus[] = [];
  const agent = new Agent(path, () => llm, (event) => {
    if (event.type === "status") statuses.push(event.status);
  });

  await agent.inject("背景信息");
  await agent.followup("用户问题");
  await agent.whenIdle();

  expect(statuses).toEqual(["running", "idle"]);
  expect(llm.requests[0]).toEqual([
    { role: "user", content: "背景信息" },
    { role: "user", content: "用户问题" },
  ]);
  const events = await load(path);
  expect(events.map((event) => event.type)).toEqual([
    "inbox_inserted",
    "inbox_inserted",
    "turn_start",
    "inbox_claimed",
    "inbox_claimed",
    "step_start",
    "user",
    "user",
    "request_start",
    "request_end",
    "assistant",
    "step_end",
    "turn_end",
  ]);
  expect(deriveInbox(events)).toEqual({ nextTurn: [], nextStep: [] });
});

test("运行中的 inject 进入当前 turn 的下一 step，followup 排到下一 turn", async () => {
  const path = await sessionPath();
  let release!: (reply: LlmReply) => void;
  let markStarted!: () => void;
  const first = new Promise<LlmReply>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const llm = new ScriptedLlm([
    first,
    { kind: "text", text: "已吸收上下文" },
    { kind: "text", text: "第二轮完成" },
  ], markStarted);
  const agent = new Agent(path, () => llm);

  await agent.followup("第一问");
  await started;
  await agent.inject("运行中上下文");
  await agent.followup("第二问");
  release({ kind: "text", text: "第一步回答" });
  await agent.whenIdle();

  const events = await load(path);
  expect(events.filter((event) => event.type === "turn_start").map((event) => event.turn))
    .toEqual([1, 2]);
  expect(events.filter((event) => event.type === "step_start")).toEqual([
    { type: "step_start", turn: 1, step: 1 },
    { type: "step_start", turn: 1, step: 2 },
    { type: "step_start", turn: 2, step: 1 },
  ]);
  expect(llm.requests[1]?.at(-1)).toEqual({ role: "user", content: "运行中上下文" });
  expect(llm.requests[2]?.at(-1)).toEqual({ role: "user", content: "第二问" });
});

test("新 Agent 能从日志恢复未领取的 inject", async () => {
  const path = await sessionPath();
  await new Agent(path, () => new ScriptedLlm([])).inject("持久背景");

  const llm = new ScriptedLlm([{ kind: "text", text: "完成" }]);
  const resumed = new Agent(path, () => llm);
  await resumed.followup("继续");
  await resumed.whenIdle();

  expect(llm.requests[0]?.slice(-2)).toEqual([
    { role: "user", content: "持久背景" },
    { role: "user", content: "继续" },
  ]);
  expect(deriveInbox(await load(path))).toEqual({ nextTurn: [], nextStep: [] });
});

test("preStep 可以改写进入模型并持久化的消息", async () => {
  const path = await sessionPath();
  const llm = new ScriptedLlm([{ kind: "text", text: "完成" }]);
  const seen: Array<{ turn: number; step: number; messages: readonly string[] }> = [];
  const agent = new Agent(path, () => llm, undefined, {
    preStep: ({ agent: subject, signal, ...payload }) => {
      expect(subject).toBe(agent);
      expect(signal).toBeInstanceOf(AbortSignal);
      seen.push(payload);
      return { kind: "enter", messages: payload.messages.map((text) => `改写：${text}`) };
    },
  });

  await agent.followup("原始问题");
  await agent.whenIdle();

  expect(seen).toEqual([{ turn: 1, step: 1, messages: ["原始问题"] }]);
  expect(llm.requests[0]?.at(-1)).toEqual({ role: "user", content: "改写：原始问题" });
  expect((await load(path)).find((event) => event.type === "user")).toEqual({
    type: "user",
    text: "改写：原始问题",
  });
});

test("preStep 拒绝首次输入时闭合 turn，但不打开 step 或调用模型", async () => {
  const path = await sessionPath();
  const llm = new ScriptedLlm([{ kind: "text", text: "不应调用" }]);
  const agent = new Agent(path, () => llm, undefined, {
    preStep: () => ({ kind: "reject" }),
  });

  await agent.followup("拒绝我");
  await agent.whenIdle();

  expect(llm.requests).toHaveLength(0);
  expect((await load(path)).map((event) => event.type)).toEqual([
    "inbox_inserted",
    "turn_start",
    "inbox_claimed",
    "turn_end",
  ]);
  expect((await load(path)).at(-1)).toEqual({
    type: "turn_end",
    turn: 1,
    reason: { kind: "blocked" },
  });
});

test("preStep 将首次输入改写为空时保留空 turn", async () => {
  const path = await sessionPath();
  const llm = new ScriptedLlm([{ kind: "text", text: "不应调用" }]);
  const agent = new Agent(path, () => llm, undefined, {
    preStep: () => ({ kind: "enter", messages: [] }),
  });

  await agent.followup("丢弃我");
  await agent.whenIdle();

  expect(llm.requests).toHaveLength(0);
  expect((await load(path)).filter((event) => event.type.startsWith("step_"))).toEqual([]);
  expect((await load(path)).at(-1)).toEqual({
    type: "turn_end",
    turn: 1,
    reason: { kind: "completed" },
  });
});

test("cancel 中止运行中的模型请求，闭合边界后回到 idle", async () => {
  const path = await sessionPath();
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  const llm: LlmClient = {
    async complete(_messages, _tools, signal) {
      expect(signal).toBeInstanceOf(AbortSignal);
      requestStarted();
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  };
  const statuses: AgentStatus[] = [];
  let recoveryCalls = 0;
  const agent = new Agent(path, () => llm, (event) => {
    if (event.type === "status") statuses.push(event.status);
  }, {
    requestError: () => {
      recoveryCalls += 1;
      return { kind: "retry" };
    },
  });

  await agent.followup("等待取消");
  await started;
  agent.cancel();
  await agent.whenIdle();

  expect(agent.status).toBe("idle");
  expect(agent.error).toBeUndefined();
  expect(recoveryCalls).toBe(0);
  expect(statuses).toEqual(["running", "idle"]);
  expect((await load(path)).map((event) => event.type)).toEqual([
    "inbox_inserted",
    "turn_start",
    "inbox_claimed",
    "step_start",
    "user",
    "request_start",
    "request_end",
    "step_end",
    "turn_end",
  ]);
  expect((await load(path)).at(-1)).toEqual({
    type: "turn_end",
    turn: 1,
    reason: { kind: "aborted", reason: { kind: "user" } },
  });
});

test("cancel 能中止退避等待且不会开启下一 attempt", async () => {
  const path = await sessionPath();
  let waiting!: () => void;
  const waitStarted = new Promise<void>((resolve) => { waiting = resolve; });
  const clock: RetryClock = {
    sleep(_delayMs, signal) {
      waiting();
      return new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve(false), { once: true });
      });
    },
  };
  let calls = 0;
  const agent = new Agent(path, () => ({
    async complete() {
      calls += 1;
      throw new HarnessError("temporary timeout", "TIMEOUT");
    },
  }), undefined, {
    requestError: createRetryPolicy({ jitterRatio: 0 }, { clock }),
  });

  await agent.followup("等待退避");
  await waitStarted;
  agent.cancel();
  await agent.whenIdle();

  expect(calls).toBe(1);
  expect(agent.status).toBe("idle");
  expect(agent.error).toBeUndefined();
  expect((await load(path)).filter((event) => event.type === "request_start"))
    .toHaveLength(1);
  expect((await load(path)).at(-1)).toEqual({
    type: "turn_end",
    turn: 1,
    reason: { kind: "aborted", reason: { kind: "user" } },
  });
});
