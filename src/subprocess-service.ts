import { spawn } from "node:child_process";
import { Context, Service } from "@deepseek-ai/cordis";
import { ToolError } from "./tools.ts";

const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/iu;
const DEFAULT_MAX_BYTES = 64_000;
const DEFAULT_GRACE_MS = 1_000;

export type SubprocessSpawnSpec = {
  argv: readonly string[];
  cwd: string;
  signal: AbortSignal;
  maxBytes?: number;
  graceMs?: number;
  env?: Record<string, string>;
};

export type SubprocessResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
};

export interface SubprocessProvider {
  spawn(spec: SubprocessSpawnSpec): Promise<SubprocessResult>;
}

/** 父进程环境去掉凭据形名称，避免 API Key 隐式进入子进程。 */
export function scrubbedParentEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SENSITIVE_ENV_PATTERN.test(key)) env[key] = value;
  }
  return env;
}

export class LocalSubprocessProvider implements SubprocessProvider {
  spawn(spec: SubprocessSpawnSpec): Promise<SubprocessResult> {
    if (spec.argv.length === 0 || spec.argv[0]!.trim().length === 0) {
      return Promise.reject(new ToolError("subprocess argv is empty", "SUBPROCESS_INVALID_ARGV"));
    }
    const [file, ...args] = spec.argv;
    const maxBytes = spec.maxBytes ?? DEFAULT_MAX_BYTES;
    const graceMs = spec.graceMs ?? DEFAULT_GRACE_MS;
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(file!, args, {
          cwd: spec.cwd,
          env: { ...scrubbedParentEnv(), ...spec.env },
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        reject(new ToolError("subprocess spawn failed", "SUBPROCESS_SPAWN_FAILED", { cause: error }));
        return;
      }

      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let truncated = false;
      let settled = false;
      const append = (current: Buffer, chunk: Buffer) => {
        const next = Buffer.concat([current, chunk]);
        if (next.length <= maxBytes) return next;
        truncated = true;
        return next.subarray(next.length - maxBytes);
      };
      child.stdout?.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr?.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });

      const terminate = () => {
        child.kill("SIGTERM");
        const killer = setTimeout(() => child.kill("SIGKILL"), graceMs);
        killer.unref();
      };
      if (spec.signal.aborted) terminate();
      else spec.signal.addEventListener("abort", terminate, { once: true });

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        spec.signal.removeEventListener("abort", terminate);
        reject(new ToolError("subprocess spawn failed", "SUBPROCESS_SPAWN_FAILED", { cause: error }));
      });
      child.on("close", (exitCode, signal) => {
        if (settled) return;
        settled = true;
        spec.signal.removeEventListener("abort", terminate);
        resolve({
          exitCode,
          signal,
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
          truncated,
        });
      });
    });
  }
}

declare module "@deepseek-ai/cordis" {
  interface Context { subprocess: SubprocessService }
}

export class SubprocessService extends Service implements SubprocessProvider {
  constructor(ctx: Context, private readonly provider: SubprocessProvider) {
    super(ctx, "subprocess");
  }

  spawn(spec: SubprocessSpawnSpec): Promise<SubprocessResult> {
    return this.provider.spawn(spec);
  }
}
