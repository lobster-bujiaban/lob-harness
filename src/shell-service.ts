import { Context, Service } from "@deepseek-ai/cordis";
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
    return runBash(this.subprocess, ["bash", "-c", request.command], request);
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
      const result = await runBash(this.subprocess, ["bash", "-c", request.command], request);
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
    const result = await runBash(this.subprocess, confined.argv, request);
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

function resolvePolicy(
  policies: SandboxPolicyService | SandboxExecutionPolicy,
  cwd: string,
): SandboxExecutionPolicy {
  return "resolve" in policies ? policies.resolve(cwd) : policies;
}

async function runBash(
  subprocess: SubprocessProvider,
  argv: readonly string[],
  request: ShellRunRequest,
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
      env: { ...MODEL_ENV },
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
