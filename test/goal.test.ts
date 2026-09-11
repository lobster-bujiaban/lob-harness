import { readFileSync } from "node:fs";
import { Context } from "@deepseek-ai/cordis";
import { expect, test } from "vitest";
import { AgentService } from "../src/agent-service.ts";
import { AgentLoopService } from "../src/agent-loop-service.ts";
import { CharacterTokenMeter } from "../src/context.ts";
import { FakeLlm, type LlmClient, type ToolSchema } from "../src/llm.ts";
import { LlmService } from "../src/llm-service.ts";
import { MemorySessionPersistence } from "../src/session-persistence.ts";
import { projectMessages, type SessionEvent } from "../src/session.ts";
import { SessionStoreService } from "../src/session-service.ts";
import { SystemPromptService } from "../src/system-prompt.ts";
import { installCoreTools } from "../src/tools.ts";
import { CHILD_TOOL_EXCLUDE, ToolsService } from "../src/tools-service.ts";
import { deriveGoal, installGoal } from "../src/goal.ts";
import { GoalsService } from "../src/goal-service.ts";
import type { ModelMessage } from "../src/session.ts";

class ProbeLlm implements LlmClient {
  readonly seenTools: string[][] = [];

  constructor(private readonly inner: LlmClient) {}

  complete(messages: ModelMessage[], tools: ToolSchema[], signal?: AbortSignal) {
    this.seenTools.push(tools.map((tool) => tool.name));
    return this.inner.complete(messages, tools, signal);
  }
}

async function harness(create: (prompt: string) => LlmClient) {
  const ctx = new Context();
  const persistence = new MemorySessionPersistence();
  const probes: ProbeLlm[] = [];
  const fibers = [
    ctx.plugin(SessionStoreService, { tmp: persistence }),
    ctx.plugin(LlmService, {
      async create(prompt: string) {
        const probe = new ProbeLlm(create(prompt));
        probes.push(probe);
        return probe;
      },
      async describe() {
        return { provider: "openai-compatible" as const, baseURL: "https://test", model: "test", hasApiKey: true };
      },
      async update() { return this.describe(); },
    }),
    ctx.plugin(ToolsService),
    ctx.plugin(SystemPromptService),
    ctx.plugin(AgentLoopService),
  ];
  await Promise.all(fibers.map((fiber) => fiber.await()));
  const agents = ctx.plugin(AgentService, { maxInputTokens: 10_000, meter: new CharacterTokenMeter() });
  await agents.await();
  const goals = ctx.plugin(GoalsService);
  await goals.await();
  ctx.tools.register("core-tools", (registry) => installCoreTools(registry));
  ctx.tools.register("tool-goal", (registry, _workspaceRoot, scope) => {
    if (scope?.owner === undefined) return;
    return installGoal(registry, {
      goals: ctx.goals,
      owner: scope.owner,
    });
  });
  return {
    ctx,
    probes,
    async dispose() {
      await goals.dispose();
      await agents.dispose();
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    },
  };
}

test("create_goal 写入日志，get/complete 从同一份日志折叠", async () => {
  const { ctx, probes, dispose } = await harness(() => new FakeLlm([
    { kind: "tool", calls: [{ id: "g-1", name: "create_goal", args: { objective: "ship demo 12.4" } }] },
    { kind: "tool", calls: [{ id: "g-2", name: "get_goal", args: {} }] },
    { kind: "tool", calls: [{ id: "g-3", name: "complete_goal", args: {} }] },
    { kind: "text", text: "goal-done" },
  ]));
  await ctx.sessions.get("tmp").create("session.jsonl");
  const agent = ctx.agents.create({ source: "tmp", id: "session.jsonl", workspaceRoot: "/workspace" });
  await agent.followup("track a goal");
  await agent.whenIdle();
  expect(agent.error).toBeUndefined();

  const events = await ctx.sessions.get("tmp").load("session.jsonl");
  const changes = events.filter((event) => event.type === "goal_change");
  expect(changes).toHaveLength(2);
  expect(changes[0]).toMatchObject({
    type: "goal_change",
    action: "create",
    goal: { revision: 1, objective: "ship demo 12.4", phase: "active" },
  });
  expect(changes[1]).toMatchObject({
    type: "goal_change",
    action: "complete",
    goal: { revision: 2, objective: "ship demo 12.4", phase: "completed" },
  });
  expect(changes[0]?.type === "goal_change" ? changes[0].goal.id : "").toBe(
    changes[1]?.type === "goal_change" ? changes[1].goal.id : "",
  );
  expect(deriveGoal(events)).toMatchObject({
    objective: "ship demo 12.4",
    phase: "completed",
    revision: 2,
  });
  expect(await ctx.goals.get("tmp", "session.jsonl")).toEqual(deriveGoal(events));

  const getResult = events.find((event) => event.type === "tool_result" && event.name === "get_goal");
  expect(getResult?.type === "tool_result" ? JSON.parse(getResult.output) : null).toMatchObject({
    goal: { objective: "ship demo 12.4", phase: "active", revision: 1 },
  });
  expect(probes[0]?.seenTools[0]).toEqual(expect.arrayContaining(["get_goal", "create_goal", "complete_goal"]));
  expect(probes[0]?.seenTools[0]).not.toContain("goal");

  ctx.agents.release("tmp", "session.jsonl", agent);
  await dispose();
});

test("活跃目标不可覆盖；完成后可替换，折叠只认最后一次变更", async () => {
  const { ctx, dispose } = await harness(() => new FakeLlm([
    { kind: "tool", calls: [{ id: "g-1", name: "create_goal", args: { objective: "first" } }] },
    { kind: "tool", calls: [{ id: "g-2", name: "create_goal", args: { objective: "second" } }] },
    { kind: "tool", calls: [{ id: "g-3", name: "complete_goal", args: {} }] },
    { kind: "tool", calls: [{ id: "g-4", name: "create_goal", args: { objective: "third" } }] },
    { kind: "text", text: "replaced" },
  ]));
  await ctx.sessions.get("tmp").create("session.jsonl");
  const agent = ctx.agents.create({ source: "tmp", id: "session.jsonl", workspaceRoot: "/workspace" });
  await agent.followup("replace goal");
  await agent.whenIdle();
  expect(agent.error).toBeUndefined();

  const events = await ctx.sessions.get("tmp").load("session.jsonl");
  const rejected = events.find((event) => event.type === "tool_result" && event.name === "create_goal" && event.isError);
  expect(rejected).toMatchObject({
    isError: true,
    error: { code: "GOAL_ALREADY_ACTIVE" },
  });
  expect(events.filter((event) => event.type === "goal_change")).toHaveLength(3);
  expect(deriveGoal(events)).toMatchObject({ objective: "third", phase: "active", revision: 1 });

  ctx.agents.release("tmp", "session.jsonl", agent);
  await dispose();
});

test("没有父会话作用域时不注册 goal 工具；exclude 可去掉工具名", async () => {
  const ctx = new Context();
  const tools = ctx.plugin(ToolsService);
  await tools.await();
  ctx.tools.register("core-tools", (registry) => installCoreTools(registry));
  ctx.tools.register("tool-goal", (registry, _workspaceRoot, scope) => {
    if (scope?.owner === undefined) return;
    registry.register({
      name: "create_goal",
      description: "goal",
      parameters: { type: "object" },
      executionMode: { kind: "exclusive" },
      execute: () => "created",
    });
  });
  expect(ctx.tools.createRegistry("/workspace").schemas().map((tool) => tool.name)).toEqual(["echo"]);
  expect(ctx.tools.createRegistry("/workspace", {
    owner: { source: "tmp", sessionId: "session.jsonl" },
  }).schemas().map((tool) => tool.name)).toEqual(["echo", "create_goal"]);
  expect(ctx.tools.createRegistry("/workspace", {
    owner: { source: "tmp", sessionId: "child.jsonl" },
    exclude: CHILD_TOOL_EXCLUDE,
  }).schemas().map((tool) => tool.name)).toEqual(["echo"]);
  await tools.dispose();
});

test("Loop 源码不出现 goal 分支", () => {
  const source = readFileSync(new URL("../src/loop.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/goal_change|create_goal|get_goal|complete_goal/u);
});

test("goal_change 不进入模型投影", () => {
  const events: SessionEvent[] = [
    { type: "user", text: "track this" },
    {
      type: "goal_change",
      action: "create",
      goal: { id: "goal-1", revision: 1, objective: "ship", phase: "active" },
    },
    { type: "assistant", text: "ok" },
    {
      type: "goal_change",
      action: "complete",
      goal: { id: "goal-1", revision: 2, objective: "ship", phase: "completed" },
    },
  ];
  expect(projectMessages(events)).toEqual([
    { role: "user", content: "track this" },
    { role: "assistant", content: "ok" },
  ]);
});
