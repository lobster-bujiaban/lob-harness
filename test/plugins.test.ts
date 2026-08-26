import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { PluginStore } from "../src/plugins.ts";

test("插件发现、启停、配置和持久化共同决定工具注册表", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tiny-harness-plugins-"));
  const store = new PluginStore(directory);

  expect((await store.list()).map((entry) => [entry.id, entry.phase])).toEqual([
    ["core-tools", "active"],
    ["workspace-files", "active"],
    ["workspace-shell", "active"],
    ["mcp-client", "disabled"],
    ["subagent", "active"],
    ["tool-jobs", "active"],
    ["tool-goal", "active"],
    ["hyperframes-video", "active"],
  ]);
  expect((await store.createToolRegistry(directory)).schemas().map((tool) => tool.name)).toEqual([
    "echo",
    "read_file",
    "list_files",
    "write_file",
    "edit",
    "grep",
    "bash",
    "video_analyze_source",
    "video_create_hyperframes",
    "video_render_hyperframes",
  ]);

  await store.update("workspace-files", {
    enabled: false,
    config: { maxFileBytes: 2048 },
  });
  const restored = new PluginStore(directory);
  expect((await restored.list()).find((entry) => entry.id === "workspace-files")).toMatchObject({
    enabled: false,
    phase: "disabled",
    config: { maxFileBytes: 2048 },
  });
  expect((await restored.createToolRegistry(directory)).schemas().map((tool) => tool.name)).toEqual([
    "echo",
    "bash",
    "video_analyze_source",
    "video_create_hyperframes",
    "video_render_hyperframes",
  ]);
  expect(JSON.parse(await readFile(join(directory, "plugins.json"), "utf8"))).toMatchObject({
    version: 1,
    plugins: { "workspace-files": { enabled: false } },
  });
});

test("插件配置在写入前校验", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tiny-harness-plugins-invalid-"));
  const store = new PluginStore(directory);
  await expect(store.update("workspace-files", { config: { maxFileBytes: 0 } })).rejects.toThrow(
    "maxFileBytes",
  );
  await expect(store.update("workspace-shell", { config: { timeoutMs: 0 } })).rejects.toThrow(
    "timeoutMs",
  );
  await expect(store.update("mcp-client", { config: { serverName: "bad name" } })).rejects.toThrow(
    "serverName",
  );
  await expect(store.update("hyperframes-video", { config: { renderTimeoutMs: 1 } })).rejects.toThrow(
    "renderTimeoutMs",
  );
  await expect(store.update("missing", { enabled: true })).rejects.toThrow("unknown plugin");
});

test("插件可重复 reload，旧贡献先撤销且新注册不重复", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tiny-harness-plugins-reload-"));
  const store = new PluginStore(directory);
  const before = await store.createToolRegistry(directory);

  await expect(store.reload("workspace-files", { config: { maxFileBytes: 2048 } })).resolves.toMatchObject({
    phase: "active",
    config: { maxFileBytes: 2048 },
  });
  await expect(store.reload("workspace-files")).resolves.toMatchObject({ phase: "active" });

  expect(store.context.tools.entries()).toEqual(["core-tools", "workspace-shell", "subagent", "tool-jobs", "tool-goal", "hyperframes-video", "workspace-files"]);
  expect(before.schemas().map((tool) => tool.name)).toEqual([
    "echo",
    "read_file",
    "list_files",
    "write_file",
    "edit",
    "grep",
    "bash",
    "video_analyze_source",
    "video_create_hyperframes",
    "video_render_hyperframes",
  ]);
  expect((await store.createToolRegistry(directory)).schemas().map((tool) => tool.name)).toEqual([
    "echo",
    "bash",
    "video_analyze_source",
    "video_create_hyperframes",
    "video_render_hyperframes",
    "read_file",
    "list_files",
    "write_file",
    "edit",
    "grep",
  ]);
});

test("禁用插件不能 reload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tiny-harness-plugins-reload-disabled-"));
  const store = new PluginStore(directory);
  await store.update("workspace-files", { enabled: false });
  await expect(store.reload("workspace-files")).rejects.toThrow("plugin is disabled");
});
