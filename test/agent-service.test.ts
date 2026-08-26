import { Context } from "@deepseek-ai/cordis";
import { expect, test } from "vitest";
import { AgentService } from "../src/agent-service.ts";
import { AgentLoopService } from "../src/agent-loop-service.ts";
import { CharacterTokenMeter } from "../src/context.ts";
import { FakeLlm } from "../src/llm.ts";
import { HarnessError } from "../src/errors.ts";
import { LlmService } from "../src/llm-service.ts";
import { MemorySessionPersistence } from "../src/session-persistence.ts";
import { SessionStoreService } from "../src/session-service.ts";
import { SystemPromptService } from "../src/system-prompt.ts";
import { ToolsService } from "../src/tools-service.ts";

async function services() {
  const ctx = new Context();
  const fibers = [
    ctx.plugin(SessionStoreService, { tmp: new MemorySessionPersistence() }),
    ctx.plugin(LlmService, {
      async create() { return new FakeLlm([{ kind: "text", text: "done" }]); },
      async describe() { return { provider: "openai-compatible" as const, baseURL: "https://test", model: "test", hasApiKey: true }; },
      async update() { return this.describe(); },
    }),
    ctx.plugin(ToolsService),
    ctx.plugin(SystemPromptService),
    ctx.plugin(AgentLoopService),
  ];
  await Promise.all(fibers.map((fiber) => fiber.await()));
  return { ctx, fibers };
}

test("AgentService 统一装配依赖并保证单会话互斥", async () => {
  const { ctx, fibers } = await services();
  await ctx.sessions.get("tmp").create("one.jsonl");
  const serviceFiber = ctx.plugin(AgentService, {
    maxInputTokens: 10_000,
    meter: new CharacterTokenMeter(),
  });
  await serviceFiber.await();
  const agent = ctx.agents.create({ source: "tmp", id: "one.jsonl", workspaceRoot: "/workspace" });
  expect(() => ctx.agents.create({ source: "tmp", id: "one.jsonl", workspaceRoot: "/workspace" }))
    .toThrow("session already running");
  await agent.followup("hello");
  await agent.whenIdle();
  expect(agent.error).toBeUndefined();
  ctx.agents.release("tmp", "one.jsonl", agent);
  expect(ctx.agents.get("tmp", "one.jsonl")).toBeUndefined();
  await serviceFiber.dispose();
  expect(ctx.get("agents")).toBeUndefined();
  await Promise.all(fibers.map((fiber) => fiber.dispose()));
});

test("Agent Loop 实现可替换，所属 Fiber 卸载后能力消失", async () => {
  const ctx = new Context();
  let calls = 0;
  const loopFiber = ctx.plugin(AgentLoopService, {
    async run() { calls += 1; },
  });
  await loopFiber.await();
  await ctx.agentLoop.run("unused", new FakeLlm([]), "hello");
  expect(calls).toBe(1);
  await loopFiber.dispose();
  expect(ctx.get("agentLoop")).toBeUndefined();
});

test("AgentService 等待五项依赖，依赖卸载时自动清理", async () => {
  const ctx = new Context();
  const serviceFiber = ctx.plugin(AgentService, {
    maxInputTokens: 10_000,
    meter: new CharacterTokenMeter(),
  });
  await serviceFiber.await();
  expect(ctx.get("agents")).toBeUndefined();
  const { ctx: ready, fibers } = await services();
  const active = ready.plugin(AgentService, { maxInputTokens: 10_000, meter: new CharacterTokenMeter() });
  await active.await();
  expect(ready.get("agents")).toBeDefined();
  await fibers[0]?.dispose();
  expect(ready.get("agents")).toBeUndefined();
  await active.dispose();
  await Promise.all(fibers.slice(1).map((fiber) => fiber.dispose()));
  await serviceFiber.dispose();
});

test("pre-step waterfall 可改写消息，监听 Fiber 卸载后自动恢复默认", async () => {
  const { ctx, fibers } = await services();
  const serviceFiber = ctx.plugin(AgentService, { maxInputTokens: 10_000, meter: new CharacterTokenMeter() });
  await serviceFiber.await();
  const hookFiber = ctx.plugin((child) => child.on("agent/pre-step", async (payload, next) => {
    const decision = await next();
    return decision.kind === "enter"
      ? { kind: "enter" as const, messages: decision.messages.map((text) => `改写:${text}`) }
      : decision;
  }));
  await hookFiber.await();
  await ctx.sessions.get("tmp").create("first.jsonl");
  const first = ctx.agents.create({ source: "tmp", id: "first.jsonl", workspaceRoot: "/workspace" });
  await first.followup("hello");
  await first.whenIdle();
  expect((await ctx.sessions.get("tmp").load("first.jsonl")).find((event) => event.type === "user"))
    .toMatchObject({ text: "改写:hello" });
  ctx.agents.release("tmp", "first.jsonl", first);

  await hookFiber.dispose();
  await ctx.sessions.get("tmp").create("second.jsonl");
  const second = ctx.agents.create({ source: "tmp", id: "second.jsonl", workspaceRoot: "/workspace" });
  await second.followup("hello");
  await second.whenIdle();
  expect((await ctx.sessions.get("tmp").load("second.jsonl")).find((event) => event.type === "user"))
    .toMatchObject({ text: "hello" });
  ctx.agents.release("tmp", "second.jsonl", second);
  await serviceFiber.dispose();
  await Promise.all(fibers.map((fiber) => fiber.dispose()));
});

test("request-error waterfall 可决定立即重试", async () => {
  const ctx = new Context();
  let calls = 0;
  const dependencies = [
    ctx.plugin(SessionStoreService, { tmp: new MemorySessionPersistence() }),
    ctx.plugin(LlmService, {
      async create() {
        return {
          async complete() {
            calls += 1;
            if (calls === 1) throw new HarnessError("limited", "RATE_LIMITED");
            return { kind: "text" as const, text: "done" };
          },
        };
      },
      async describe() { return { provider: "openai-compatible" as const, baseURL: "https://test", model: "test", hasApiKey: true }; },
      async update() { return this.describe(); },
    }),
    ctx.plugin(ToolsService),
    ctx.plugin(SystemPromptService),
    ctx.plugin(AgentLoopService),
  ];
  await Promise.all(dependencies.map((fiber) => fiber.await()));
  const serviceFiber = ctx.plugin(AgentService, { maxInputTokens: 10_000, meter: new CharacterTokenMeter() });
  const hookFiber = ctx.plugin((child) => child.on("agent/request-error", ({ failure }) =>
    failure.code === "RATE_LIMITED" ? { kind: "retry" as const } : undefined));
  await Promise.all([serviceFiber.await(), hookFiber.await()]);
  await ctx.sessions.get("tmp").create("retry.jsonl");
  const agent = ctx.agents.create({ source: "tmp", id: "retry.jsonl", workspaceRoot: "/workspace" });
  await agent.followup("hello");
  await agent.whenIdle();
  expect(calls).toBe(2);
  expect(agent.error).toBeUndefined();
  await hookFiber.dispose();
  await serviceFiber.dispose();
  await Promise.all(dependencies.map((fiber) => fiber.dispose()));
});
