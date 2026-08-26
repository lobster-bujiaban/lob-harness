import { readFileSync } from "node:fs";
import { Context } from "@deepseek-ai/cordis";
import { expect, test } from "vitest";
import { AgentService } from "../src/agent-service.ts";
import { AgentLoopService } from "../src/agent-loop-service.ts";
import { CharacterTokenMeter } from "../src/context.ts";
import { FakeLlm, type LlmClient, type LlmReply, type ToolSchema } from "../src/llm.ts";
import { LlmService } from "../src/llm-service.ts";
import { MemorySessionPersistence } from "../src/session-persistence.ts";
import { projectMessages, type SessionEvent } from "../src/session.ts";
import { SessionStoreService } from "../src/session-service.ts";
import { SystemPromptService } from "../src/system-prompt.ts";
import { installSubagent } from "../src/subagent.ts";
import { SubagentService } from "../src/subagent-service.ts";
import { installCoreTools } from "../src/tools.ts";
import { ToolsService } from "../src/tools-service.ts";
import type { ModelMessage } from "../src/session.ts";

class ProbeLlm implements LlmClient {
  readonly seenTools: string[][] = [];

  constructor(private readonly inner: FakeLlm) {}

  complete(messages: ModelMessage[], tools: ToolSchema[], signal?: AbortSignal) {
    this.seenTools.push(tools.map((tool) => tool.name));
    return this.inner.complete(messages, tools, signal);
  }
}

async function harness(script: (prompt: string) => LlmReply[]) {
  const ctx = new Context();
  const persistence = new MemorySessionPersistence();
  const probes: ProbeLlm[] = [];
  const fibers = [
    ctx.plugin(SessionStoreService, { tmp: persistence }),
    ctx.plugin(LlmService, {
      async create(prompt: string) {
        const probe = new ProbeLlm(new FakeLlm(script(prompt)));
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
  const subagents = ctx.plugin(SubagentService);
  await subagents.await();
  ctx.tools.register("core-tools", (registry) => installCoreTools(registry));
  ctx.tools.register("subagent", (registry, workspaceRoot, scope) => {
    if (scope?.owner === undefined) return;
    return installSubagent(registry, {
      subagents: ctx.subagents,
      owner: { ...scope.owner, workspaceRoot },
    });
  });
  return {
    ctx,
    persistence,
    probes,
    async dispose() {
      await subagents.dispose();
      await agents.dispose();
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    },
  };
}

test("子 Agent 用独立会话，中间步骤不进入父级投影", async () => {
  const { ctx, probes, dispose } = await harness((prompt) => prompt.startsWith("review")
    ? [
      { kind: "tool", calls: [{ id: "echo-1", name: "echo", args: { text: "inner" } }] },
      { kind: "text", text: "child-ok" },
    ]
    : [
      { kind: "tool", calls: [{ id: "sa-1", name: "subagent", args: { prompt: "review files" } }] },
      { kind: "text", text: "parent-ok" },
    ]);
  await ctx.sessions.get("tmp").create("parent.jsonl");
  const parent = ctx.agents.create({ source: "tmp", id: "parent.jsonl", workspaceRoot: "/workspace" });
  await parent.followup("delegate");
  await parent.whenIdle();
  expect(parent.error).toBeUndefined();

  const parentEvents = await ctx.sessions.get("tmp").load("parent.jsonl");
  const childStarted = parentEvents.find((event) => event.type === "subagent_started");
  expect(childStarted).toMatchObject({ type: "subagent_started", prompt: "review files" });
  if (childStarted?.type !== "subagent_started") throw new Error("missing start");
  const childEvents = await ctx.sessions.get("tmp").load(childStarted.childId);

  expect(childEvents[0]).toMatchObject({
    type: "subagent_descriptor",
    parentSessionId: "parent.jsonl",
    mode: "continuable",
  });
  expect(childEvents.some((event) => event.type === "tool_call" && event.name === "echo")).toBe(true);
  expect(parentEvents.some((event) => event.type === "tool_call" && event.name === "echo")).toBe(false);
  expect(projectMessages(parentEvents).some((message) =>
    message.role === "assistant" && message.tool_calls?.some((call) => call.function.name === "echo"),
  )).toBe(false);
  expect(parentEvents.find((event) => event.type === "tool_result" && event.name === "subagent")).toMatchObject({
    output: expect.stringContaining("started subagent"),
  });
  expect(parentEvents.find((event) => event.type === "tool_result" && event.name === "subagent")?.output)
    .toContain("child-ok");
  expect(projectMessages(parentEvents).some((message) => message.role === "tool" && message.content.includes("child-ok")))
    .toBe(true);

  expect(probes[0]?.seenTools[0]).toContain("subagent");
  expect(probes[1]?.seenTools[0]).toContain("echo");
  expect(probes[1]?.seenTools[0]).not.toContain("subagent");

  ctx.agents.release("tmp", "parent.jsonl", parent);
  await dispose();
});

test("同一 childId 可从子日志恢复并继续，外人不许接管", async () => {
  let childId = "";
  const { ctx, dispose } = await harness((prompt) => {
    if (prompt.startsWith("review")) {
      return [
        { kind: "tool", calls: [{ id: "echo-1", name: "echo", args: { text: prompt } }] },
        { kind: "text", text: `done:${prompt}` },
      ];
    }
    if (prompt === "continue") {
      return [
        { kind: "tool", calls: [{ id: "sa-2", name: "subagent", args: { prompt: "review-2", childId } }] },
        { kind: "text", text: "parent-2" },
      ];
    }
    return [
      { kind: "tool", calls: [{ id: "sa-1", name: "subagent", args: { prompt: "review-1" } }] },
      { kind: "text", text: "parent-1" },
    ];
  });
  await ctx.sessions.get("tmp").create("parent.jsonl");
  const parent = ctx.agents.create({ source: "tmp", id: "parent.jsonl", workspaceRoot: "/workspace" });
  await parent.followup("start");
  await parent.whenIdle();
  const first = (await ctx.sessions.get("tmp").load("parent.jsonl"))
    .find((event) => event.type === "tool_result" && event.name === "subagent");
  childId = String(first?.type === "tool_result" ? first.output.match(/^started subagent (\S+)/u)?.[1] : "");
  expect(childId).toMatch(/^child-.+\.jsonl$/u);

  await parent.followup("continue");
  await parent.whenIdle();
  expect(parent.error).toBeUndefined();

  const childEvents = await ctx.sessions.get("tmp").load(childId);
  expect(childEvents.filter((event) => event.type === "user").map((event) => event.type === "user" ? event.text : ""))
    .toEqual(["review-1", "review-2"]);
  expect(childEvents.filter((event) => event.type === "assistant").at(-1)).toMatchObject({ text: "done:review-2" });
  expect((await ctx.sessions.get("tmp").load("parent.jsonl"))
    .filter((event) => event.type === "subagent_ended")).toHaveLength(2);

  await expect(ctx.subagents.followup({
    parentSessionId: "stranger.jsonl",
    source: "tmp",
    workspaceRoot: "/workspace",
    childId,
    prompt: "hijack",
    signal: new AbortController().signal,
  })).rejects.toMatchObject({ code: "SUBAGENT_UNAUTHORIZED" });

  ctx.agents.release("tmp", "parent.jsonl", parent);
  await dispose();
});

test("没有父会话作用域时不注册 subagent；exclude 可去掉嵌套委派", async () => {
  const ctx = new Context();
  const tools = ctx.plugin(ToolsService);
  await tools.await();
  ctx.tools.register("core-tools", (registry) => installCoreTools(registry));
  ctx.tools.register("subagent", (registry, workspaceRoot, scope) => {
    if (scope?.owner === undefined) return;
    registry.register({
      name: "subagent",
      description: "delegate",
      parameters: { type: "object" },
      executionMode: { kind: "exclusive" },
      execute: () => workspaceRoot,
    });
  });
  expect(ctx.tools.createRegistry("/workspace").schemas().map((tool) => tool.name)).toEqual(["echo"]);
  expect(ctx.tools.createRegistry("/workspace", {
    owner: { source: "tmp", sessionId: "parent.jsonl" },
  }).schemas().map((tool) => tool.name)).toEqual(["echo", "subagent"]);
  expect(ctx.tools.createRegistry("/workspace", {
    owner: { source: "tmp", sessionId: "child.jsonl" },
    exclude: ["subagent"],
  }).schemas().map((tool) => tool.name)).toEqual(["echo"]);
  await tools.dispose();
});

test("Loop 源码不出现 subagent 分支", () => {
  const source = readFileSync(new URL("../src/loop.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/subagent/u);
});

test("子 Agent 归属事件不进入模型投影", () => {
  const events: SessionEvent[] = [
    { type: "subagent_descriptor", parentSessionId: "parent.jsonl", mode: "continuable" },
    { type: "user", text: "task" },
    { type: "subagent_started", childId: "child.jsonl", prompt: "task" },
    { type: "assistant", text: "ok" },
    { type: "subagent_ended", childId: "child.jsonl", output: "ok" },
  ];
  expect(projectMessages(events)).toEqual([
    { role: "user", content: "task" },
    { role: "assistant", content: "ok" },
  ]);
});
