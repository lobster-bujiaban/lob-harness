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
import { installCoreTools } from "../src/tools.ts";
import { CHILD_TOOL_EXCLUDE, ToolsService } from "../src/tools-service.ts";
import { installJobs } from "../src/jobs.ts";
import { JobsService } from "../src/jobs-service.ts";
import { throwIfAborted } from "../src/errors.ts";
import type { ModelMessage } from "../src/session.ts";

class ProbeLlm implements LlmClient {
  readonly seenTools: string[][] = [];

  constructor(private readonly inner: LlmClient) {}

  complete(messages: ModelMessage[], tools: ToolSchema[], signal?: AbortSignal) {
    this.seenTools.push(tools.map((tool) => tool.name));
    return this.inner.complete(messages, tools, signal);
  }
}

class GatedLlm implements LlmClient {
  constructor(private readonly gate: Promise<void>, private readonly reply: LlmReply) {}

  async complete(_messages: ModelMessage[], _tools: ToolSchema[], signal?: AbortSignal) {
    await Promise.race([
      this.gate,
      signal === undefined ? new Promise<void>(() => undefined) : aborted(signal),
    ]);
    throwIfAborted(signal);
    return this.reply;
  }
}

function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
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
  const jobs = ctx.plugin(JobsService);
  await jobs.await();
  ctx.tools.register("core-tools", (registry) => installCoreTools(registry));
  ctx.tools.register("tool-jobs", (registry, workspaceRoot, scope) => {
    if (scope?.owner === undefined) return;
    return installJobs(registry, {
      jobs: ctx.jobs,
      owner: { ...scope.owner, workspaceRoot },
    });
  });
  return {
    ctx,
    probes,
    async dispose() {
      await jobs.dispose();
      await agents.dispose();
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    },
  };
}

test("job 立即返回，父级可继续，结果只在子日志", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { ctx, probes, dispose } = await harness((prompt) => prompt.startsWith("background")
    ? new GatedLlm(gate, { kind: "text", text: "job-done" })
    : new FakeLlm([
      { kind: "tool", calls: [{ id: "j-1", name: "job", args: { prompt: "background work" } }] },
      { kind: "text", text: "parent-ok" },
    ]));
  await ctx.sessions.get("tmp").create("parent.jsonl");
  const parent = ctx.agents.create({ source: "tmp", id: "parent.jsonl", workspaceRoot: "/workspace" });
  await parent.followup("delegate");
  await parent.whenIdle();
  expect(parent.error).toBeUndefined();

  const parentEvents = await ctx.sessions.get("tmp").load("parent.jsonl");
  const started = parentEvents.find((event) => event.type === "job_started");
  expect(started).toMatchObject({ type: "job_started", prompt: "background work" });
  if (started?.type !== "job_started") throw new Error("missing start");
  expect(parentEvents.some((event) => event.type === "job_ended")).toBe(false);
  expect(projectMessages(parentEvents).some((message) => message.role === "assistant" && message.content === "parent-ok"))
    .toBe(true);
  expect(parentEvents.find((event) => event.type === "tool_result" && event.name === "job")?.output)
    .toContain(`started job ${started.jobId}`);

  const running = await ctx.jobs.output(started.jobId, "parent.jsonl");
  expect(running.status).toBe("running");

  const childEvents = await ctx.sessions.get("tmp").load(started.jobId);
  expect(childEvents[0]).toMatchObject({
    type: "job_descriptor",
    parentSessionId: "parent.jsonl",
    prompt: "background work",
  });
  expect(childEvents.some((event) => event.type === "assistant")).toBe(false);
  expect(parentEvents.some((event) => event.type === "tool_call" && event.name === "echo")).toBe(false);

  expect(probes[0]?.seenTools[0]).toContain("job");
  expect(probes[1]?.seenTools[0]).not.toContain("job");
  expect(probes[1]?.seenTools[0]).not.toContain("write_file");
  expect(probes[1]?.seenTools[0]).not.toContain("edit");

  release();
  const settled = await ctx.jobs.wait(started.jobId, "parent.jsonl");
  expect(settled).toMatchObject({ status: "completed", output: "job-done" });
  expect(renderContainsEnded(await ctx.sessions.get("tmp").load("parent.jsonl"), started.jobId)).toBe(true);
  expect(projectMessages(await ctx.sessions.get("tmp").load("parent.jsonl")).some((message) =>
    message.role === "assistant" && message.content === "job-done",
  )).toBe(false);

  ctx.agents.release("tmp", "parent.jsonl", parent);
  await dispose();
});

test("job_output 与 kill 按父会话隔离；已结束再 kill 不改状态", async () => {
  const { ctx, dispose } = await harness((prompt) => prompt.startsWith("background")
    ? new FakeLlm([{ kind: "text", text: "done" }])
    : new FakeLlm([
      { kind: "tool", calls: [{ id: "j-1", name: "job", args: { prompt: "background work" } }] },
      { kind: "text", text: "parent-ok" },
    ]));
  await ctx.sessions.get("tmp").create("parent.jsonl");
  await ctx.sessions.get("tmp").create("other.jsonl");
  const parent = ctx.agents.create({ source: "tmp", id: "parent.jsonl", workspaceRoot: "/workspace" });
  await parent.followup("delegate");
  await parent.whenIdle();
  const started = (await ctx.sessions.get("tmp").load("parent.jsonl")).find((event) => event.type === "job_started");
  if (started?.type !== "job_started") throw new Error("missing start");
  await ctx.jobs.wait(started.jobId, "parent.jsonl");

  const output = await ctx.jobs.output(started.jobId, "parent.jsonl");
  expect(output).toMatchObject({ status: "completed", output: "done" });
  await expect(ctx.jobs.output(started.jobId, "other.jsonl")).rejects.toMatchObject({ code: "JOB_UNAUTHORIZED" });
  await expect(ctx.jobs.kill("missing.jsonl", "parent.jsonl")).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
  await expect(ctx.jobs.kill(started.jobId, "parent.jsonl")).resolves.toMatchObject({
    status: "completed",
    requested: false,
  });

  ctx.agents.release("tmp", "parent.jsonl", parent);
  await dispose();
});

test("kill 会取消仍在运行的 job", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { ctx, dispose } = await harness((prompt) => prompt.startsWith("background")
    ? new GatedLlm(gate, { kind: "text", text: "should-not-finish" })
    : new FakeLlm([
      { kind: "tool", calls: [{ id: "j-1", name: "job", args: { prompt: "background work" } }] },
      { kind: "text", text: "parent-ok" },
    ]));
  await ctx.sessions.get("tmp").create("parent.jsonl");
  const parent = ctx.agents.create({ source: "tmp", id: "parent.jsonl", workspaceRoot: "/workspace" });
  await parent.followup("delegate");
  await parent.whenIdle();
  const started = (await ctx.sessions.get("tmp").load("parent.jsonl")).find((event) => event.type === "job_started");
  if (started?.type !== "job_started") throw new Error("missing start");

  const killed = await ctx.jobs.kill(started.jobId, "parent.jsonl");
  expect(killed).toMatchObject({ status: "killed", requested: true });
  release();
  expect(await ctx.jobs.output(started.jobId, "parent.jsonl")).toMatchObject({ status: "killed" });

  ctx.agents.release("tmp", "parent.jsonl", parent);
  await dispose();
});

test("没有父会话作用域时不注册 job 工具；exclude 可去掉工具名", async () => {
  const ctx = new Context();
  const tools = ctx.plugin(ToolsService);
  await tools.await();
  ctx.tools.register("core-tools", (registry) => installCoreTools(registry));
  ctx.tools.register("workspace-files", (registry) => {
    registry.register({
      name: "write_file",
      description: "write",
      parameters: { type: "object" },
      executionMode: { kind: "exclusive" },
      execute: () => "wrote",
    });
  });
  ctx.tools.register("tool-jobs", (registry, workspaceRoot, scope) => {
    if (scope?.owner === undefined) return;
    registry.register({
      name: "job",
      description: "job",
      parameters: { type: "object" },
      executionMode: { kind: "exclusive" },
      execute: () => workspaceRoot,
    });
  });
  expect(ctx.tools.createRegistry("/workspace").schemas().map((tool) => tool.name)).toEqual(["echo", "write_file"]);
  expect(ctx.tools.createRegistry("/workspace", {
    owner: { source: "tmp", sessionId: "parent.jsonl" },
  }).schemas().map((tool) => tool.name)).toEqual(["echo", "write_file", "job"]);
  expect(ctx.tools.createRegistry("/workspace", {
    owner: { source: "tmp", sessionId: "child.jsonl" },
    exclude: CHILD_TOOL_EXCLUDE,
  }).schemas().map((tool) => tool.name)).toEqual(["echo"]);
  await tools.dispose();
});

test("Loop 源码不出现 job 分支", () => {
  const source = readFileSync(new URL("../src/loop.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/job_output|job_kill|job_started/u);
});

test("job 归属事件不进入模型投影", () => {
  const events: SessionEvent[] = [
    { type: "job_descriptor", parentSessionId: "parent.jsonl", prompt: "task" },
    { type: "user", text: "task" },
    { type: "job_started", jobId: "job.jsonl", prompt: "task" },
    { type: "assistant", text: "ok" },
    { type: "job_ended", jobId: "job.jsonl", status: "completed", output: "ok" },
  ];
  expect(projectMessages(events)).toEqual([
    { role: "user", content: "task" },
    { role: "assistant", content: "ok" },
  ]);
});

function renderContainsEnded(events: SessionEvent[], jobId: string): boolean {
  return events.some((event) => event.type === "job_ended" && event.jobId === jobId);
}
