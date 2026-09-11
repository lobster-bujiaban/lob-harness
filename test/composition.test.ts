import { expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyProfilePatch, assembleWebContext, dumpWebConfig, loadWebConfig, readProfilePatch } from "../src/composition.ts";
import { CharacterTokenMeter } from "../src/context.ts";
import { FakeLlm } from "../src/llm.ts";
import { MemorySessionPersistence } from "../src/session-persistence.ts";
import { SystemPromptRegistry } from "../src/system-prompt.ts";
import { LocalFsProvider } from "../src/fs-service.ts";

test("web 组合 base 与 server 入口", () => {
  const web = loadWebConfig();
  expect(web.entries[1]?.id).toBe("web-server");
  expect(web.entries[0]?.children?.map((entry) => entry.id)).toEqual([
    "session",
    "llm",
    "fs",
    "subprocess",
    "sandbox-policy",
    "sandbox",
    "shell",
    "tools",
    "system-prompt",
    "agent-loop",
    "agent",
    "subagents",
    "jobs",
    "goals",
  ]);
});

test("每次加载返回独立配置，dump 输出最终 JSON", () => {
  const first = loadWebConfig();
  first.entries[0]?.children?.push({ id: "local-change" });

  const dumped = JSON.parse(dumpWebConfig()) as ReturnType<typeof loadWebConfig>;
  expect(dumped.entries[0]?.children?.some((entry) => entry.id === "local-change")).toBe(false);
  expect(dumped.product).toBe("web");
});

test("base 条目驱动 Context Service 装配", () => {
  const config = loadWebConfig();
  config.entries[0]!.children = config.entries[0]!.children?.filter((entry) => entry.id !== "agent");
  const context = assembleWebContext(config, {
    sessionProviders: { jsonl: { tmp: new MemorySessionPersistence() } },
    llmProviders: { settings: {
      async create() { return new FakeLlm([]); },
      async describe() {
        return { provider: "openai-compatible", baseURL: "https://example.test", model: "test", hasApiKey: false };
      },
      async update() { throw new Error("not supported"); },
    } },
    fsProviders: { local: new LocalFsProvider() },
    systemPrompt: new SystemPromptRegistry(),
    contextBudget: { maxInputTokens: 1000, meter: new CharacterTokenMeter() },
  });

  expect(context.get("sessions")).toBeDefined();
  expect(context.get("llm")).toBeDefined();
  expect(context.get("fs")).toBeDefined();
  expect(context.get("subprocess")).toBeDefined();
  expect(context.get("sandboxPolicy")).toBeDefined();
  expect(context.get("sandbox")).toBeDefined();
  expect(context.get("shell")).toBeDefined();
  expect(context.get("tools")).toBeDefined();
  expect(context.get("systemPrompt")).toBeDefined();
  expect(context.get("agentLoop")).toBeDefined();
  expect(context.get("agents")).toBeUndefined();
});

test("profile 按 id 整体替换 config，并驱动 Provider 选择", async () => {
  const profile = {
    version: 1 as const,
    patches: [
      { id: "session", config: { provider: "memory" } },
      { id: "workspace-files", config: { maxFileBytes: 2048 } },
    ],
  };
  const config = applyProfilePatch(loadWebConfig(), profile);
  const workspaceFiles = config.entries[0]?.children
    ?.find((entry) => entry.id === "tools")?.children
    ?.find((entry) => entry.id === "workspace-files");
  expect(workspaceFiles?.config).toEqual({ maxFileBytes: 2048 });

  const memory = new MemorySessionPersistence();
  const context = assembleWebContext(config, {
    sessionProviders: {
      jsonl: { tmp: new MemorySessionPersistence() },
      memory: { tmp: memory },
    },
    llmProviders: { settings: {
      async create() { return new FakeLlm([]); },
      async describe() {
        return { provider: "openai-compatible", baseURL: "https://example.test", model: "test", hasApiKey: false };
      },
      async update() { throw new Error("not supported"); },
    } },
    fsProviders: { local: new LocalFsProvider() },
    systemPrompt: new SystemPromptRegistry(),
    contextBudget: { maxInputTokens: 1000, meter: new CharacterTokenMeter() },
  });
  await context.sessions.get("tmp").create("profile.jsonl");
  expect(await memory.list()).toEqual([{ id: "profile.jsonl", updatedAt: 1 }]);
});

test("profile config 是整段替换而不是深合并", () => {
  const config = loadWebConfig();
  const tools = config.entries[0]?.children?.find((entry) => entry.id === "tools");
  tools!.config = { limits: { concurrency: 4, timeoutMs: 1000 }, keep: true };
  const patched = applyProfilePatch(config, {
    version: 1,
    patches: [{ id: "tools", config: { limits: { concurrency: 2 } } }],
  });
  expect(patched.entries[0]?.children?.find((entry) => entry.id === "tools")?.config).toEqual({
    limits: { concurrency: 2 },
  });
});

test("profile 可替换 shell Provider", () => {
  const config = applyProfilePatch(loadWebConfig(), {
    version: 1,
    patches: [{ id: "shell", config: { provider: "virtual" } }],
  });
  const context = assembleWebContext(config, {
    sessionProviders: { jsonl: { tmp: new MemorySessionPersistence() } },
    llmProviders: { settings: {
      async create() { return new FakeLlm([]); },
      async describe() {
        return { provider: "openai-compatible", baseURL: "https://example.test", model: "test", hasApiKey: false };
      },
      async update() { throw new Error("not supported"); },
    } },
    fsProviders: { local: new LocalFsProvider() },
    shellProviders: { virtual: { async run() { throw new Error("virtual shell"); } } },
    systemPrompt: new SystemPromptRegistry(),
    contextBudget: { maxInputTokens: 1000, meter: new CharacterTokenMeter() },
  });
  expect(context.get("shell")).toBeDefined();
});

test("从 JSON 文件读取并校验 profile", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lob-profile-"));
  const path = join(directory, "web.json");
  await writeFile(path, JSON.stringify({
    version: 1,
    patches: [{ id: "llm", config: { provider: "settings" } }],
  }));
  await expect(readProfilePatch(path)).resolves.toEqual({
    version: 1,
    patches: [{ id: "llm", config: { provider: "settings" } }],
  });
});
