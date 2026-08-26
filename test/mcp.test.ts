import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { FakeLlm } from "../src/llm.ts";
import { runTurn } from "../src/loop.ts";
import {
  MemoryMcpSession,
  contributeMcpTools,
  createDemoMcpSession,
  installMcpTools,
  mcpPublicName,
} from "../src/mcp.ts";
import { PluginStore } from "../src/plugins.ts";
import { load } from "../src/session.ts";
import { ToolRegistry, installCoreTools } from "../src/tools.ts";
import { ToolsService } from "../src/tools-service.ts";
import { Context } from "@deepseek-ai/cordis";

test("MCP 工具与本地工具挂在同一张表，公开名带 server 前缀", async () => {
  const session = createDemoMcpSession();
  const registry = new ToolRegistry();
  installCoreTools(registry);
  installMcpTools(registry, {
    serverName: "demo",
    session,
    tools: await session.listTools(),
  });

  expect(registry.schemas().map((tool) => tool.name)).toEqual(["echo", "mcp__demo__ping"]);
  await expect(registry.execute("echo", { text: "hi" }, new AbortController().signal))
    .resolves.toEqual({ output: "hi", isError: false });
  await expect(registry.execute("mcp__demo__ping", { text: "hi" }, new AbortController().signal))
    .resolves.toEqual({ output: "pong:hi", isError: false });
});

test("MCP 断连后本地工具仍在，已关闭会话的调用失败", async () => {
  const session = createDemoMcpSession();
  const registry = new ToolRegistry();
  installCoreTools(registry);
  const dispose = installMcpTools(registry, {
    serverName: "demo",
    session,
    tools: await session.listTools(),
  });

  await session.close();
  await expect(registry.execute("mcp__demo__ping", { text: "hi" }, new AbortController().signal))
    .resolves.toMatchObject({ isError: true, error: { code: "MCP_DISCONNECTED" } });
  await expect(registry.execute("echo", { text: "still" }, new AbortController().signal))
    .resolves.toEqual({ output: "still", isError: false });

  dispose();
  expect(registry.get("mcp__demo__ping")).toBeUndefined();
  expect(registry.get("echo")).toBeDefined();
});

test("MCP 工具走同一条 preExecute 与会话日志，Loop 不出现 mcp 字样", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tiny-harness-mcp-"));
  const path = join(dir, "session.jsonl");
  const session = createDemoMcpSession();
  const registry = new ToolRegistry();
  installCoreTools(registry);
  installMcpTools(registry, {
    serverName: "demo",
    session,
    tools: await session.listTools(),
  });
  registry.onPreExecute((execution, next) => execution.name === mcpPublicName("demo", "ping")
    && typeof execution.args === "object"
    && execution.args !== null
    && "text" in execution.args
    && String((execution.args as { text: unknown }).text) === "blocked"
    ? { kind: "deny", reason: "mcp ping blocked" }
    : next());

  const denied = await registry.execute("mcp__demo__ping", { text: "blocked" }, new AbortController().signal);
  expect(denied).toMatchObject({ isError: true, error: { code: "DENIED" } });

  const llm = new FakeLlm([
    { kind: "tool", calls: [{ id: "1", name: "mcp__demo__ping", args: { text: "ok" } }] },
    { kind: "text", text: "mcp 已完成" },
  ]);
  await runTurn(path, llm, "调用 ping", { toolRegistry: registry });
  const events = await load(path);
  expect(events).toContainEqual({ type: "tool_call", id: "1", name: "mcp__demo__ping", args: { text: "ok" } });
  expect(events).toContainEqual({ type: "tool_result", id: "1", name: "mcp__demo__ping", output: "pong:ok" });

  const src = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/loop.ts", import.meta.url), "utf8"));
  expect(src.includes("mcp")).toBe(false);
});

test("发现失败且 failOnStartupError=false 时不注册远端工具", async () => {
  const context = new Context();
  const tools = new ToolsService(context);
  tools.register("core-tools", (registry) => installCoreTools(registry));
  const session = new MemoryMcpSession([]);
  session.listTools = async () => {
    throw new Error("server down");
  };
  await contributeMcpTools(tools, { serverName: "demo", session, failOnStartupError: false });
  expect(tools.createRegistry("/tmp").schemas().map((tool) => tool.name)).toEqual(["echo"]);
});

test("插件启用 MCP 后出现远端工具，禁用后本地工具仍在", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tiny-harness-mcp-plugin-"));
  const store = new PluginStore(directory);
  expect((await store.list()).find((entry) => entry.id === "mcp-client")).toMatchObject({
    enabled: false,
    phase: "disabled",
    config: { serverName: "demo" },
  });
  expect((await store.createToolRegistry(directory)).schemas().map((tool) => tool.name)).toEqual([
    "echo",
    "read_file",
    "list_files",
    "write_file",
    "bash",
  ]);

  await store.update("mcp-client", { enabled: true });
  expect((await store.createToolRegistry(directory)).schemas().map((tool) => tool.name)).toContain("mcp__demo__ping");

  await store.update("mcp-client", { enabled: false });
  const names = (await store.createToolRegistry(directory)).schemas().map((tool) => tool.name);
  expect(names).toEqual(["echo", "read_file", "list_files", "write_file", "bash"]);
  expect(names.includes("mcp__demo__ping")).toBe(false);
});
