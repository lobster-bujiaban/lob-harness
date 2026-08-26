import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Context, type FiberState } from "@deepseek-ai/cordis";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import { installBash } from "./bash.ts";
import { installReadFile } from "./files.ts";
import { contributeMcpTools, createDemoMcpSession } from "./mcp.ts";
import { installSubagent } from "./subagent.ts";
import { installJobs } from "./jobs.ts";
import { installGoal } from "./goal.ts";
import { installCoreTools, ToolRegistry } from "./tools.ts";
import { ToolsService } from "./tools-service.ts";
import { FsService, LocalFsProvider } from "./fs-service.ts";
import { ShellService, SandboxBashProvider, SandboxPowerShellProvider } from "./shell-service.ts";
import { SubprocessService, LocalSubprocessProvider } from "./subprocess-service.ts";
import { SandboxService, LocalSandboxProvider } from "./sandbox-service.ts";
import { SandboxPolicyService } from "./sandbox-policy.ts";

export type PluginManifest = {
  id: string;
  name: string;
  description: string;
  tools: string[];
  configurable: boolean;
  defaultEnabled: boolean;
};

export type PluginInventoryEntry = PluginManifest & {
  enabled: boolean;
  phase: "pending" | "loading" | "active" | "failed" | "unloading" | "disabled";
  config: Record<string, unknown>;
};

type SavedPlugins = {
  version: 1;
  plugins: Record<string, { enabled?: boolean; config?: Record<string, unknown> }>;
};

export const BUILTIN_PLUGINS: readonly PluginManifest[] = Object.freeze([
  {
    id: "core-tools",
    name: "Core Tools",
    description: "基础工具插件，提供 echo。",
    tools: ["echo"],
    configurable: false,
    defaultEnabled: true,
  },
  {
    id: "workspace-files",
    name: "Workspace Files",
    description: "工作区文件插件，提供受根目录约束的 read_file、list_files 与 write_file。",
    tools: ["read_file", "list_files", "write_file"],
    configurable: true,
    defaultEnabled: true,
  },
  {
    id: "workspace-shell",
    name: "Workspace Shell",
    description: "工作区 shell 插件，提供受根目录约束的 bash。",
    tools: [process.platform === "win32" ? "pwsh" : "bash"],
    configurable: true,
    defaultEnabled: true,
  },
  {
    id: "mcp-client",
    name: "MCP Client",
    description: "把一个 MCP 服务器的工具注册到同一张工具表。默认关闭。",
    tools: ["mcp__demo__ping"],
    configurable: true,
    defaultEnabled: false,
  },
  {
    id: "subagent",
    name: "Subagent",
    description: "把任务委派给可继续的子 Agent。子级使用独立会话日志。",
    tools: ["subagent"],
    configurable: false,
    defaultEnabled: true,
  },
  {
    id: "tool-jobs",
    name: "Background Jobs",
    description: "后台启动子 Agent，立即返回 jobId；用 job_output / job_kill 观察或取消。",
    tools: ["job", "job_output", "job_kill"],
    configurable: false,
    defaultEnabled: true,
  },
  {
    id: "tool-goal",
    name: "Session Goal",
    description: "同会话持久目标：状态写进日志，模型用 get_goal / create_goal / complete_goal 读写。",
    tools: ["get_goal", "create_goal", "complete_goal"],
    configurable: false,
    defaultEnabled: true,
  },
]);

export class PluginStore {
  private readonly path: string;
  private readonly ready: Promise<void>;

  constructor(private readonly directory: string, readonly context = new Context()) {
    this.path = join(directory, "plugins.json");
    if (context.get("tools") === undefined) new ToolsService(context);
    if (context.get("fs") === undefined) new FsService(context, new LocalFsProvider());
    if (context.get("subprocess") === undefined) new SubprocessService(context, new LocalSubprocessProvider());
    if (context.get("sandboxPolicy") === undefined) new SandboxPolicyService(context);
    if (context.get("sandbox") === undefined) new SandboxService(context, new LocalSandboxProvider());
    if (context.get("shell") === undefined) {
      const provider = process.platform === "win32"
        ? new SandboxPowerShellProvider(context.subprocess, context.sandbox, context.sandboxPolicy)
        : new SandboxBashProvider(context.subprocess, context.sandbox, context.sandboxPolicy);
      new ShellService(context, provider);
    }
    this.ready = this.initialize();
  }

  async list(): Promise<PluginInventoryEntry[]> {
    await this.ready;
    const saved = await this.read();
    return BUILTIN_PLUGINS.map((manifest) => {
      const entry = saved.plugins[manifest.id];
      const loaderEntry = this.context.loader.resolve(manifest.id);
      const enabled = !loaderEntry.disabled;
      return {
        ...manifest,
        enabled,
        phase: enabled ? fiberPhase(loaderEntry.fiber?.state) : "disabled",
        config: resolveConfig(manifest.id, entry?.config ?? {}),
      };
    });
  }

  async update(id: string, input: { enabled?: unknown; config?: unknown }): Promise<PluginInventoryEntry> {
    await this.ready;
    const manifest = BUILTIN_PLUGINS.find((item) => item.id === id);
    if (manifest === undefined) throw new Error(`unknown plugin: ${id}`);
    const saved = await this.read();
    const current = saved.plugins[id] ?? {};
    const enabled = input.enabled === undefined ? current.enabled : parseEnabled(input.enabled);
    const config = resolveConfig(id, input.config === undefined ? current.config ?? {} : parseConfig(input.config));
    saved.plugins[id] = {
      ...(enabled === undefined ? {} : { enabled }),
      ...(config === undefined ? {} : { config }),
    };
    await this.context.loader.update(id, {
      disabled: enabled === undefined ? !manifest.defaultEnabled : !enabled,
      config,
    });
    await this.context.loader.await();
    await this.write(saved);
    return (await this.list()).find((item) => item.id === id)!;
  }

  async reload(id: string, input: { config?: unknown } = {}): Promise<PluginInventoryEntry> {
    await this.ready;
    const manifest = BUILTIN_PLUGINS.find((item) => item.id === id);
    if (manifest === undefined) throw new Error(`unknown plugin: ${id}`);
    const saved = await this.read();
    const current = saved.plugins[id] ?? {};
    const enabled = current.enabled ?? manifest.defaultEnabled;
    if (!enabled) throw new Error(`plugin is disabled: ${id}`);
    const config = input.config === undefined
      ? resolveConfig(id, current.config ?? {})
      : resolveConfig(id, parseConfig(input.config));
    const entry = this.context.loader.resolve(id);

    // 教学版 HMR：先完整卸载旧 Fiber，再以完整 config 重新挂载。
    await entry.update({ disabled: true });
    await entry.update({ disabled: false, config });
    await this.context.loader.await();
    if (input.config !== undefined) {
      saved.plugins[id] = { ...current, config };
      await this.write(saved);
    }
    return (await this.list()).find((item) => item.id === id)!;
  }

  async createToolRegistry(root: string): Promise<ToolRegistry> {
    await this.ready;
    return this.context.tools.createRegistry(root);
  }

  private async initialize(): Promise<void> {
    const fiber = this.context.plugin(Loader, { baseUrl: import.meta.url });
    await fiber.await();
    this.context.loader.builtins["core-tools"] = Object.assign((ctx: Context) =>
      ctx.tools.register("core-tools", (registry) => installCoreTools(registry)), { inject: ["tools"] });
    this.context.loader.builtins["workspace-files"] = Object.assign((ctx: Context, config: Record<string, unknown>) =>
      ctx.tools.register("workspace-files", (registry, root) => installReadFile(registry, {
        root,
        provider: ctx.fs,
        maxBytes: config.maxFileBytes as number,
      })), { inject: ["tools", "fs"] });
    this.context.loader.builtins["workspace-shell"] = Object.assign((ctx: Context, config: Record<string, unknown>) =>
      ctx.tools.register("workspace-shell", (registry, root) => installBash(registry, {
        root,
        provider: ctx.shell,
        toolName: process.platform === "win32" ? "pwsh" : "bash",
        timeoutMs: config.timeoutMs as number,
        policy: ctx.sandboxPolicy.resolve(root),
      })), { inject: ["tools", "shell", "sandboxPolicy"] });
    this.context.loader.builtins["mcp-client"] = Object.assign(async (ctx: Context, config: Record<string, unknown>) =>
      contributeMcpTools(ctx.tools, {
        serverName: config.serverName as string,
        session: createDemoMcpSession(),
        failOnStartupError: config.failOnStartupError as boolean,
        timeoutMs: config.timeoutMs as number,
        contributionId: "mcp-client",
      }), { inject: ["tools"] });
    this.context.loader.builtins["subagent"] = Object.assign((ctx: Context) =>
      ctx.tools.register("subagent", (registry, workspaceRoot, scope) => {
        const runtime = ctx.get("subagents");
        if (runtime === undefined || scope?.owner === undefined) return;
        return installSubagent(registry, {
          subagents: runtime,
          owner: { ...scope.owner, workspaceRoot },
        });
      }), { inject: ["tools"] });
    this.context.loader.builtins["tool-jobs"] = Object.assign((ctx: Context) =>
      ctx.tools.register("tool-jobs", (registry, workspaceRoot, scope) => {
        const runtime = ctx.get("jobs");
        if (runtime === undefined || scope?.owner === undefined) return;
        return installJobs(registry, {
          jobs: runtime,
          owner: { ...scope.owner, workspaceRoot },
        });
      }), { inject: ["tools"] });
    this.context.loader.builtins["tool-goal"] = Object.assign((ctx: Context) =>
      ctx.tools.register("tool-goal", (registry, _workspaceRoot, scope) => {
        const runtime = ctx.get("goals");
        if (runtime === undefined || scope?.owner === undefined) return;
        return installGoal(registry, {
          goals: runtime,
          owner: scope.owner,
        });
      }), { inject: ["tools"] });
    const saved = await this.read();
    for (const manifest of BUILTIN_PLUGINS) {
      const entry = saved.plugins[manifest.id];
      await this.context.loader.create({
        id: manifest.id,
        name: `cordis:${manifest.id}`,
        disabled: !(entry?.enabled ?? manifest.defaultEnabled),
        config: resolveConfig(manifest.id, entry?.config ?? {}),
      } as never);
    }
    await this.context.loader.await();
  }

  private async read(): Promise<SavedPlugins> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
      const plugins = (value as { plugins?: unknown }).plugins;
      if (typeof plugins !== "object" || plugins === null || Array.isArray(plugins)) throw new Error();
      return { version: 1, plugins: plugins as SavedPlugins["plugins"] };
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) return { version: 1, plugins: {} };
      throw new Error("插件设置文件无效", { cause: error });
    }
  }

  private async write(value: SavedPlugins): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.path);
      await chmod(this.path, 0o600);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}

function fiberPhase(state: FiberState | undefined): PluginInventoryEntry["phase"] {
  switch (state) {
    case 0: return "pending";
    case 1: return "loading";
    case 2: return "active";
    case 3: return "failed";
    case 5: return "unloading";
    default: return "disabled";
  }
}

function parseEnabled(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("enabled 必须是布尔值");
  return value;
}

function parseConfig(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("config 必须是对象");
  }
  return structuredClone(value as Record<string, unknown>);
}

function resolveConfig(id: string, config: Record<string, unknown>): Record<string, unknown> {
  if (id === "workspace-files") {
    const maxFileBytes = config.maxFileBytes ?? 1_048_576;
    if (!Number.isSafeInteger(maxFileBytes) || (maxFileBytes as number) < 1 || (maxFileBytes as number) > 10_485_760) {
      throw new Error("workspace-files.maxFileBytes 必须是 1～10485760 的整数");
    }
    return { maxFileBytes };
  }
  if (id === "workspace-shell") {
    const timeoutMs = config.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(timeoutMs) || (timeoutMs as number) < 1 || (timeoutMs as number) > 600_000) {
      throw new Error("workspace-shell.timeoutMs 必须是 1～600000 的整数");
    }
    return { timeoutMs };
  }
  if (id === "mcp-client") {
    const serverName = config.serverName ?? "demo";
    if (typeof serverName !== "string" || !/^[A-Za-z0-9_-]{1,32}$/u.test(serverName)) {
      throw new Error("mcp-client.serverName 必须是 1～32 位字母数字、下划线或连字符");
    }
    const failOnStartupError = config.failOnStartupError ?? false;
    if (typeof failOnStartupError !== "boolean") {
      throw new Error("mcp-client.failOnStartupError 必须是布尔值");
    }
    const timeoutMs = config.timeoutMs ?? 60_000;
    if (!Number.isSafeInteger(timeoutMs) || (timeoutMs as number) < 1 || (timeoutMs as number) > 600_000) {
      throw new Error("mcp-client.timeoutMs 必须是 1～600000 的整数");
    }
    return { serverName, failOnStartupError, timeoutMs };
  }
  return structuredClone(config);
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === code;
}
