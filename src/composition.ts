import { readFile } from "node:fs/promises";
import { Context } from "@deepseek-ai/cordis";
import { AgentLoopService } from "./agent-loop-service.ts";
import { AgentService } from "./agent-service.ts";
import type { ContextBudget } from "./context.ts";
import { LlmService, type LlmProviderService } from "./llm-service.ts";
import { SessionStoreService } from "./session-service.ts";
import type { SessionPersistence } from "./session-persistence.ts";
import { SystemPromptService, type SystemPromptProvider } from "./system-prompt.ts";
import { ToolsService } from "./tools-service.ts";
import { FsService, type FsProvider } from "./fs-service.ts";
import { SubprocessService, type SubprocessProvider, LocalSubprocessProvider } from "./subprocess-service.ts";
import { ShellService, type ShellProvider, LocalBashProvider, LocalPowerShellProvider, SandboxBashProvider, SandboxPowerShellProvider } from "./shell-service.ts";
import { SandboxService, type SandboxBackend, LocalSandboxProvider } from "./sandbox-service.ts";
import { SandboxPolicyService, parseSandboxMode } from "./sandbox-policy.ts";
import { SubagentService } from "./subagent-service.ts";
import { JobsService } from "./jobs-service.ts";
import { GoalsService } from "./goal-service.ts";

export type ConfigEntry = {
  id: string;
  config?: Record<string, unknown>;
  children?: ConfigEntry[];
};

export type ProductConfig = {
  product: "web";
  entries: ConfigEntry[];
};

export type ProfilePatch = {
  version: 1;
  patches: { id: string; config: Record<string, unknown> }[];
};

export type WebAssemblyOptions = {
  context?: Context;
  sessionProviders: Record<string, Record<string, SessionPersistence>>;
  llmProviders: Record<string, LlmProviderService>;
  fsProviders: Record<string, FsProvider>;
  subprocessProviders?: Record<string, SubprocessProvider>;
  shellProviders?: Record<string, ShellProvider>;
  sandboxProviders?: Record<string, SandboxBackend>;
  systemPrompt: SystemPromptProvider;
  contextBudget: ContextBudget;
  platform?: NodeJS.Platform;
};

const baseEntries: readonly ConfigEntry[] = Object.freeze([
  { id: "session", config: { provider: "jsonl" } },
  { id: "llm", config: { provider: "settings" } },
  { id: "fs", config: { provider: "local" } },
  { id: "subprocess", config: { provider: "local" } },
  { id: "sandbox-policy", config: { mode: "workspace-write" } },
  { id: "sandbox", config: { provider: "local" } },
  { id: "shell", config: { provider: "sandbox" } },
  { id: "tools", children: [{ id: "core-tools" }, { id: "workspace-files" }, { id: "workspace-shell" }, { id: "mcp-client", config: { serverName: "demo" } }, { id: "subagent" }, { id: "tool-jobs" }, { id: "tool-goal" }] },
  { id: "system-prompt" },
  { id: "agent-loop" },
  { id: "agent" },
  { id: "subagents" },
  { id: "jobs" },
  { id: "goals" },
]);

export function loadWebConfig(profile?: ProfilePatch): ProductConfig {
  const config: ProductConfig = {
    product: "web",
    entries: [
      { id: "base", children: structuredClone([...baseEntries]) },
      { id: "web-server" },
    ],
  };
  return profile === undefined ? config : applyProfilePatch(config, profile);
}

export function dumpWebConfig(config: ProductConfig = loadWebConfig()): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export async function readProfilePatch(path: string): Promise<ProfilePatch> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`profile 文件无效: ${path}`, { cause: error });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("profile 格式无效");
  const raw = value as { version?: unknown; patches?: unknown };
  if (raw.version !== 1 || !Array.isArray(raw.patches)) throw new Error("profile 格式无效");
  const patches = raw.patches.map((patch) => {
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) throw new Error("profile patch 格式无效");
    const item = patch as { id?: unknown; config?: unknown };
    if (typeof item.id !== "string" || item.id.trim().length === 0) throw new Error("profile patch id 无效");
    if (typeof item.config !== "object" || item.config === null || Array.isArray(item.config)) {
      throw new Error(`profile patch config 无效: ${item.id}`);
    }
    return { id: item.id, config: structuredClone(item.config as Record<string, unknown>) };
  });
  return { version: 1, patches };
}

export function applyProfilePatch(config: ProductConfig, profile: ProfilePatch): ProductConfig {
  const result = structuredClone(config);
  const entries = new Map<string, ConfigEntry>();
  const visit = (entry: ConfigEntry) => {
    if (entries.has(entry.id)) throw new Error(`duplicate config entry id: ${entry.id}`);
    entries.set(entry.id, entry);
    entry.children?.forEach(visit);
  };
  result.entries.forEach(visit);
  const patched = new Set<string>();
  for (const patch of profile.patches) {
    if (patched.has(patch.id)) throw new Error(`duplicate profile patch: ${patch.id}`);
    patched.add(patch.id);
    const entry = entries.get(patch.id);
    if (entry === undefined) throw new Error(`unknown profile patch entry: ${patch.id}`);
    entry.config = structuredClone(patch.config);
  }
  return result;
}

export function assembleWebContext(
  config: ProductConfig,
  options: WebAssemblyOptions,
): Context {
  const base = config.entries.find((entry) => entry.id === "base");
  if (base === undefined) throw new Error("web config requires base entry");
  if (!config.entries.some((entry) => entry.id === "web-server")) {
    throw new Error("web config requires web-server entry");
  }

  const context = options.context ?? new Context();
  const platform = options.platform ?? process.platform;
  const seen = new Set<string>();
  for (const entry of base.children ?? []) {
    if (seen.has(entry.id)) throw new Error(`duplicate base entry: ${entry.id}`);
    seen.add(entry.id);
    switch (entry.id) {
      case "session":
        new SessionStoreService(context, selectProvider(options.sessionProviders, entry, "jsonl"));
        break;
      case "llm":
        new LlmService(context, selectProvider(options.llmProviders, entry, "settings"));
        break;
      case "tools":
        new ToolsService(context);
        break;
      case "fs":
        new FsService(context, selectProvider(options.fsProviders, entry, "local"));
        break;
      case "subprocess":
        new SubprocessService(context, selectProvider(
          { local: new LocalSubprocessProvider(), ...options.subprocessProviders },
          entry,
          "local",
        ));
        break;
      case "sandbox-policy":
        new SandboxPolicyService(context, { mode: parseSandboxMode(entry.config?.mode) });
        break;
      case "sandbox":
        new SandboxService(context, selectProvider(
          { local: new LocalSandboxProvider(), ...options.sandboxProviders },
          entry,
          "local",
        ));
        break;
      case "shell":
        const localShell = platform === "win32"
          ? new LocalPowerShellProvider(context.subprocess)
          : new LocalBashProvider(context.subprocess);
        const sandboxShell = platform === "win32"
          ? new SandboxPowerShellProvider(context.subprocess, context.sandbox, context.sandboxPolicy)
          : new SandboxBashProvider(context.subprocess, context.sandbox, context.sandboxPolicy);
        new ShellService(context, selectProvider(
          {
            local: localShell,
            sandbox: sandboxShell,
            ...options.shellProviders,
          },
          entry,
          "sandbox",
        ));
        break;
      case "system-prompt":
        new SystemPromptService(context, options.systemPrompt);
        break;
      case "agent-loop":
        new AgentLoopService(context);
        break;
      case "agent":
        new AgentService(context, options.contextBudget);
        break;
      case "subagents":
        new SubagentService(context);
        break;
      case "jobs":
        new JobsService(context);
        break;
      case "goals":
        new GoalsService(context);
        break;
      default:
        throw new Error(`unknown base entry: ${entry.id}`);
    }
  }
  return context;
}

function selectProvider<T>(providers: Record<string, T>, entry: ConfigEntry, fallback: string): T {
  const provider = entry.config?.provider ?? fallback;
  if (typeof provider !== "string" || provider.trim().length === 0) {
    throw new Error(`${entry.id}.config.provider must be a non-empty string`);
  }
  const selected = providers[provider];
  if (selected === undefined) throw new Error(`unknown ${entry.id} provider: ${provider}`);
  return selected;
}
