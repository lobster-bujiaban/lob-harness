import { Context, Service } from "@deepseek-ai/cordis";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SubprocessProvider } from "./subprocess-service.ts";
import type {
  ConfinedArgv,
  SandboxBackend,
  SandboxExecutionPolicy,
  SandboxMode,
} from "./sandbox-service.ts";
import type { SandboxPolicyService } from "./sandbox-policy.ts";
import { ToolError } from "./tools.ts";

const DEFAULT_MAX_BYTES = 64_000;
const MODEL_ENV = { NO_COLOR: "1", TERM: "dumb", PAGER: "cat", GIT_PAGER: "cat" } as const;
const POWERSHELL_ENV = { NO_COLOR: "1", PAGER: "cat", GIT_PAGER: "cat" } as const;
const POWERSHELL_UTF8 = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false); ";

export type ShellRunRequest = {
  command: string;
  cwd: string;
  signal: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  sandboxPolicy?: SandboxExecutionPolicy;
};

export type ShellSandboxInfo = {
  mode: SandboxMode;
  denied: boolean;
  enforcement?: "full" | "partial" | "none";
};

export type ShellRunResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  aborted: boolean;
  sandbox?: ShellSandboxInfo;
};

export interface ShellProvider {
  run(request: ShellRunRequest): Promise<ShellRunResult>;
}

/** 本地 bash 执行器：只通过 subprocess seam spawn，自己负责 deadline 和原因分类。 */
export class LocalBashProvider implements ShellProvider {
  constructor(private readonly subprocess: SubprocessProvider) {}

  async run(request: ShellRunRequest): Promise<ShellRunResult> {
    return runShell(this.subprocess, ["bash", "-c", request.command], request, MODEL_ENV);
  }
}

/** Windows PowerShell 执行器：命令作为 -Command 的单个 argv 传入，并固定 UTF-8 输出。 */
export class LocalPowerShellProvider implements ShellProvider {
  constructor(
    private readonly subprocess: SubprocessProvider,
    private readonly executable = resolvePowerShellExecutable(),
  ) {}

  async run(request: ShellRunRequest): Promise<ShellRunResult> {
    return runShell(this.subprocess, powershellArgv(this.executable, request.command), request, POWERSHELL_ENV);
  }
}

/** 在 spawn 前把 bash -c 交给 ctx.sandbox.confine；受限模式失败则拒绝裸跑。 */
export class SandboxBashProvider implements ShellProvider {
  constructor(
    private readonly subprocess: SubprocessProvider,
    private readonly sandbox: SandboxBackend,
    private readonly policies: SandboxPolicyService | SandboxExecutionPolicy,
  ) {}

  async run(request: ShellRunRequest): Promise<ShellRunResult> {
    const policy = request.sandboxPolicy ?? resolvePolicy(this.policies, request.cwd);
    if (policy.mode === "danger-full-access") {
      const result = await runShell(this.subprocess, ["bash", "-c", request.command], request, MODEL_ENV);
      return { ...result, sandbox: { mode: policy.mode, denied: false } };
    }
    let confined: ConfinedArgv;
    try {
      confined = this.sandbox.confine(["bash", "-c", request.command], {
        mode: policy.mode,
        workspaceRoot: policy.workspaceRoot,
      });
    } catch (error) {
      if (error instanceof ToolError && error.code === "SANDBOX_UNAVAILABLE") throw error;
      throw new ToolError(
        error instanceof Error ? error.message : "sandbox confine failed",
        "SANDBOX_UNAVAILABLE",
        { cause: error },
      );
    }
    const result = await runShell(this.subprocess, confined.argv, request, MODEL_ENV);
    return {
      ...result,
      sandbox: {
        mode: policy.mode,
        denied: isSandboxDenial(result, confined.denialSignatures),
        enforcement: confined.enforcement,
      },
    };
  }
}

/** Windows PowerShell 的沙箱消费方；没有 Windows backend 时受限模式失败关闭。 */
export class SandboxPowerShellProvider implements ShellProvider {
  constructor(
    private readonly subprocess: SubprocessProvider,
    private readonly sandbox: SandboxBackend,
    private readonly policies: SandboxPolicyService | SandboxExecutionPolicy,
    private readonly executable = resolvePowerShellExecutable(),
  ) {}

  async run(request: ShellRunRequest): Promise<ShellRunResult> {
    const policy = request.sandboxPolicy ?? resolvePolicy(this.policies, request.cwd);
    const argv = powershellArgv(this.executable, request.command);
    if (policy.mode === "danger-full-access") {
      const result = await runShell(this.subprocess, argv, request, POWERSHELL_ENV);
      return { ...result, sandbox: { mode: policy.mode, denied: false, enforcement: "none" } };
    }
    let confined: ConfinedArgv;
    try {
      confined = this.sandbox.confine(argv, {
        mode: policy.mode,
        workspaceRoot: policy.workspaceRoot,
      });
    } catch (error) {
      if (error instanceof ToolError && error.code === "SANDBOX_UNAVAILABLE") throw error;
      throw new ToolError(
        error instanceof Error ? error.message : "sandbox confine failed",
        "SANDBOX_UNAVAILABLE",
        { cause: error },
      );
    }
    const result = await runShell(this.subprocess, confined.argv, request, POWERSHELL_ENV);
    return {
      ...result,
      sandbox: {
        mode: policy.mode,
        denied: isSandboxDenial(result, confined.denialSignatures),
        enforcement: confined.enforcement,
      },
    };
  }
}

/** 优先 PowerShell 7，最后兼容 Windows 自带的 5.1。 */
export function resolvePowerShellExecutable(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform !== "win32") return "pwsh";
  const programFiles = env.ProgramFiles ?? "C:\\Program Files";
  const systemRoot = env.SystemRoot ?? "C:\\Windows";
  const candidates = [join(programFiles, "PowerShell", "7", "pwsh.exe")];
  for (const entry of (env.PATH ?? "").split(";")) {
    const path = entry.trim().replace(/^"|"$/gu, "");
    if (path.length > 0) candidates.push(join(path, "pwsh.exe"));
  }
  candidates.push(join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
  return candidates.find((candidate) => existsSync(candidate)) ?? "pwsh.exe";
}

function resolvePolicy(
  policies: SandboxPolicyService | SandboxExecutionPolicy,
  cwd: string,
): SandboxExecutionPolicy {
  return "resolve" in policies ? policies.resolve(cwd) : policies;
}

function powershellArgv(executable: string, command: string): string[] {
  return [executable, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `${POWERSHELL_UTF8}${command}`];
}

async function runShell(
  subprocess: SubprocessProvider,
  argv: readonly string[],
  request: ShellRunRequest,
  env: Readonly<Record<string, string>>,
): Promise<ShellRunResult> {
  const timeout = new AbortController();
  const timer = request.timeoutMs === undefined
    ? undefined
    : setTimeout(() => timeout.abort(), request.timeoutMs);
  const signal = timer === undefined ? request.signal : AbortSignal.any([request.signal, timeout.signal]);
  try {
    const spawned = await subprocess.spawn({
      argv,
      cwd: request.cwd,
      signal,
      maxBytes: request.maxBytes ?? DEFAULT_MAX_BYTES,
      env: { ...env },
    });
    const timedOut = timeout.signal.aborted && !request.signal.aborted;
    return {
      ...spawned,
      timedOut,
      aborted: request.signal.aborted && !timedOut,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isSandboxDenial(result: ShellRunResult, signatures: readonly string[]): boolean {
  if (result.timedOut || result.aborted || result.exitCode === 0) return false;
  const stderr = result.stderr.toLowerCase();
  return signatures.some((signature) => stderr.includes(signature.toLowerCase()));
}

declare module "@deepseek-ai/cordis" {
  interface Context { shell: ShellService }
}

export class ShellService extends Service implements ShellProvider {
  constructor(ctx: Context, private readonly provider: ShellProvider) {
    super(ctx, "shell");
  }

  run(request: ShellRunRequest): Promise<ShellRunResult> {
    return this.provider.run(request);
  }
}
