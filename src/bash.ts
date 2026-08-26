import { isAbsolute, relative, resolve } from "node:path";
import type { ShellProvider, ShellRunResult } from "./shell-service.ts";
import type { SandboxExecutionPolicy } from "./sandbox-service.ts";
import { ToolError, type ToolExecution, type ToolRegistry } from "./tools.ts";

export function installBash(
  registry: ToolRegistry,
  options: {
    root: string;
    provider: ShellProvider;
    timeoutMs?: number;
    deniedPrefixes?: readonly string[];
    policy?: SandboxExecutionPolicy;
  },
): () => void {
  const provider = options.provider;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const deniedPrefixes = options.deniedPrefixes ?? [];
  const root = resolve(options.root);
  const admitted = new WeakMap<Readonly<ToolExecution>, { command: string; cwd: string; timeoutMs?: number }>();

  const disposePolicy = registry.onPreExecute(async (execution, next) => {
    if (execution.name !== "bash") return next();
    const command = readString(execution.args, "command");
    if (command === undefined) {
      return { kind: "deny", reason: "bash requires a non-empty command" };
    }
    if (deniedPrefixes.some((prefix) => command.startsWith(prefix))) {
      return { kind: "deny", reason: "bash command is disabled by policy" };
    }
    const timeout = readTimeoutMs(execution.args);
    if (timeout === "invalid") {
      return { kind: "deny", reason: "bash timeoutMs must be a positive integer" };
    }
    const requested = readString(execution.args, "workdir");
    const cwd = requested === undefined
      ? root
      : isAbsolute(requested) ? resolve(requested) : resolve(root, requested);
    if (!isWithin(root, cwd)) {
      return { kind: "deny", reason: "bash workdir is outside the allowed root" };
    }
    admitted.set(execution, {
      command,
      cwd,
      ...(timeout === undefined ? {} : { timeoutMs: timeout }),
    });
    return next();
  });

  const disposeTool = registry.register({
    name: "bash",
    description: "在工作区根目录执行一条 bash 命令。每次调用都是新的 shell，状态不会保留；用 workdir 而不是 cd。文件写入可能受 sandbox 限制，拒绝时会看到 [sandbox: file access denied]。",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的 bash 命令" },
        workdir: { type: "string", description: "相对工作区根目录的工作目录" },
        timeoutMs: { type: "integer", description: "本次命令超时毫秒" },
      },
      required: ["command"],
      additionalProperties: false,
    },
    executionMode: { kind: "exclusive" },
    timeoutMs,
    async execute(_args, context) {
      const admittedCall = admitted.get(context.execution);
      if (admittedCall === undefined) {
        throw new ToolError("bash command was not admitted by policy", "SHELL_NOT_ADMITTED");
      }
      return renderShellResult(await provider.run({
        command: admittedCall.command,
        cwd: admittedCall.cwd,
        signal: context.signal,
        sandboxPolicy: options.policy,
        ...(admittedCall.timeoutMs === undefined ? {} : { timeoutMs: admittedCall.timeoutMs }),
      }));
    },
  });

  return () => {
    disposePolicy();
    disposeTool();
  };
}

export function renderShellResult(result: ShellRunResult): string {
  const lines: string[] = [];
  if (result.stdout.length > 0) lines.push(trimTrailingNewline(result.stdout));
  if (result.stderr.length > 0) lines.push(trimTrailingNewline(result.stderr));
  if (result.sandbox?.denied) {
    lines.push(`[sandbox: file access denied under ${result.sandbox.mode} mode]`);
  }
  if (result.timedOut) lines.push("[timed out]");
  else if (result.aborted) lines.push("[aborted]");
  else if (result.signal !== null) lines.push(`[killed by signal: ${result.signal}]`);
  else lines.push(`[exit code: ${result.exitCode ?? "null"}]`);
  if (result.truncated) lines.push("[truncated]");
  return lines.join("\n");
}

function readString(args: unknown, name: string): string | undefined {
  if (typeof args !== "object" || args === null || !(name in args)) return undefined;
  const value = (args as Record<string, unknown>)[name];
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return value;
}

function readTimeoutMs(args: unknown): number | undefined | "invalid" {
  if (typeof args !== "object" || args === null || !("timeoutMs" in args)) return undefined;
  const value = (args as { timeoutMs: unknown }).timeoutMs;
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) return "invalid";
  return value as number;
}

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function trimTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}
