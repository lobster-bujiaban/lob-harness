import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { Context, Service } from "@deepseek-ai/cordis";
import { ToolError } from "./tools.ts";

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type SandboxEnforcement = "full" | "partial" | "none";
export type SandboxPolicy = { mode: Exclude<SandboxMode, "danger-full-access">; workspaceRoot: string };
export type SandboxExecutionPolicy = { mode: SandboxMode; workspaceRoot: string };

export type ConfinedArgv = {
  argv: string[];
  enforcement: SandboxEnforcement;
  denialSignatures: readonly string[];
};

export interface SandboxBackend {
  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv;
}

const SEATBELT_DENIALS = ["operation not permitted"] as const;

/** 父进程环境探测：macOS sandbox-exec 能否真正套上 profile。 */
export function probeSeatbelt(): boolean {
  if (process.platform !== "darwin") return false;
  const probe = spawnSync("sandbox-exec", ["-p", "(version 1) (allow default)", "--", "true"], {
    timeout: 3_000,
    stdio: "ignore",
  });
  return probe.status === 0;
}

function canonicalRoot(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function sbplString(path: string): string {
  return `"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** 教学版 Seatbelt：默认允许，再按模式收回 file-write*。 */
export function seatbeltProfile(policy: SandboxPolicy): string {
  const forms = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* (literal ${sbplString("/dev/null")}))`,
  ];
  if (policy.mode === "workspace-write") {
    forms.push(`(allow file-write* (subpath ${sbplString(canonicalRoot(policy.workspaceRoot))}))`);
  }
  return forms.join(" ");
}

export class LocalSandboxProvider implements SandboxBackend {
  private usable: boolean | undefined;

  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
    if (argv.length === 0) throw new ToolError("sandbox argv is empty", "SANDBOX_INVALID_ARGV");
    this.usable ??= probeSeatbelt();
    if (!this.usable) {
      throw new ToolError(
        `sandbox mode "${policy.mode}" is requested but no sandbox backend is usable; refusing to run unconfined`,
        "SANDBOX_UNAVAILABLE",
      );
    }
    return {
      argv: ["sandbox-exec", "-p", seatbeltProfile(policy), "--", ...argv],
      enforcement: "full",
      denialSignatures: SEATBELT_DENIALS,
    };
  }
}

declare module "@deepseek-ai/cordis" {
  interface Context { sandbox: SandboxService }
}

export class SandboxService extends Service implements SandboxBackend {
  constructor(ctx: Context, private readonly provider: SandboxBackend) {
    super(ctx, "sandbox");
  }

  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
    return this.provider.confine(argv, policy);
  }
}
