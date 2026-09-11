import { resolve } from "node:path";
import { Context, Service } from "@deepseek-ai/cordis";
import type { SandboxExecutionPolicy, SandboxMode } from "./sandbox-service.ts";

export type SandboxPolicyConfig = { mode?: SandboxMode };

const MODES = new Set<SandboxMode>(["read-only", "workspace-write", "danger-full-access"]);

export function parseSandboxMode(value: unknown, fallback: SandboxMode = "workspace-write"): SandboxMode {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !MODES.has(value as SandboxMode)) {
    throw new Error("sandbox-policy.mode 必须是 read-only、workspace-write 或 danger-full-access");
  }
  return value as SandboxMode;
}

declare module "@deepseek-ai/cordis" {
  interface Context { sandboxPolicy: SandboxPolicyService }
}

/** 部署默认模式与每次调用的工作区根目录；执行器按调用读取，不把策略写进工具。 */
export class SandboxPolicyService extends Service {
  constructor(ctx: Context, private readonly config: SandboxPolicyConfig = {}) {
    super(ctx, "sandboxPolicy");
  }

  get defaultMode(): SandboxMode {
    return this.config.mode ?? "workspace-write";
  }

  resolve(workspaceRoot: string): SandboxExecutionPolicy {
    return { mode: this.defaultMode, workspaceRoot: resolve(workspaceRoot) };
  }
}
