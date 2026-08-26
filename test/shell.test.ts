import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { installBash } from "../src/bash.ts";
import { LocalBashProvider, LocalPowerShellProvider } from "../src/shell-service.ts";
import type { ShellProvider, ShellRunResult } from "../src/shell-service.ts";
import { LocalSubprocessProvider, scrubbedParentEnv } from "../src/subprocess-service.ts";
import type { SubprocessProvider } from "../src/subprocess-service.ts";
import { ToolRegistry } from "../src/tools.ts";

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "tiny-harness-shell-"));
  await mkdir(join(root, "nested"));
  const registry = new ToolRegistry();
  installBash(registry, {
    root,
    provider: new LocalBashProvider(new LocalSubprocessProvider()),
    deniedPrefixes: ["forbidden"],
  });
  return { root, registry };
}

function virtualShell(run: ShellProvider["run"]): ShellProvider {
  return { run };
}

test("bash 在工作区执行短命令并报告退出码", async () => {
  const { registry } = await workspace();
  const result = await registry.execute("bash", { command: "printf hello" }, new AbortController().signal);
  expect(result).toEqual({ output: "hello\n[exit code: 0]", isError: false });

  const nested = await registry.execute(
    "bash",
    { command: "pwd", workdir: "nested" },
    new AbortController().signal,
  );
  expect(nested.isError).toBe(false);
  expect(nested.output).toContain("/nested");
});

test("bash 策略拒绝空命令、禁用前缀和越界 workdir", async () => {
  const { root, registry } = await workspace();
  const outside = join(root, "..", "outside");

  for (const [args, reason] of [
    [{ command: "   " }, "non-empty command"],
    [{ command: "forbidden rm" }, "disabled by policy"],
    [{ command: "pwd", workdir: outside }, "outside the allowed root"],
    [{ command: "pwd", workdir: "../nested" }, "outside the allowed root"],
  ] as const) {
    const result = await registry.execute("bash", args, new AbortController().signal);
    expect(result).toMatchObject({ isError: true, error: { code: "DENIED" } });
    expect(result.output).toContain(reason);
  }
});

test("bash 超时后形成可回放结果，不把非零退出当基础设施失败", async () => {
  const { registry } = await workspace();
  const timedOut = await registry.execute(
    "bash",
    { command: "sleep 5", timeoutMs: 200 },
    new AbortController().signal,
  );
  expect(timedOut.isError).toBe(false);
  expect(timedOut.output).toContain("[timed out]");

  const failed = await registry.execute("bash", { command: "exit 7" }, new AbortController().signal);
  expect(failed).toEqual({ output: "[exit code: 7]", isError: false });
});

test("subprocess 不解释 argv，并丢掉凭据形环境变量", async () => {
  const previous = process.env.TINY_HARNESS_SECRET_TOKEN;
  process.env.TINY_HARNESS_SECRET_TOKEN = "should-not-leak";
  try {
    expect(scrubbedParentEnv().TINY_HARNESS_SECRET_TOKEN).toBeUndefined();
    const result = await new LocalSubprocessProvider().spawn({
      argv: ["printf", "%s", "a; echo pwned"],
      cwd: await mkdtemp(join(tmpdir(), "tiny-harness-spawn-")),
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ exitCode: 0, stdout: "a; echo pwned", truncated: false });
  } finally {
    if (previous === undefined) delete process.env.TINY_HARNESS_SECRET_TOKEN;
    else process.env.TINY_HARNESS_SECRET_TOKEN = previous;
  }
});

test("bash 工具可替换为非本地 Shell Provider", async () => {
  const calls: string[] = [];
  const provider = virtualShell(async (request) => {
    calls.push(request.command);
    return {
      exitCode: 0,
      signal: null,
      stdout: "virtual-shell",
      stderr: "",
      truncated: false,
      timedOut: false,
      aborted: false,
    } satisfies ShellRunResult;
  });
  const registry = new ToolRegistry();
  installBash(registry, { root: "/virtual", provider });

  await expect(registry.execute("bash", { command: "pwd" }, new AbortController().signal))
    .resolves.toEqual({ output: "virtual-shell\n[exit code: 0]", isError: false });
  expect(calls).toEqual(["pwd"]);
});

test("本地 bash 执行器只把 bash -c 交给 subprocess seam", async () => {
  const spawned: string[][] = [];
  const subprocess: SubprocessProvider = {
    async spawn(spec) {
      spawned.push([...spec.argv]);
      return { exitCode: 0, signal: null, stdout: "from-subprocess", stderr: "", truncated: false };
    },
  };
  const registry = new ToolRegistry();
  installBash(registry, { root: "/virtual", provider: new LocalBashProvider(subprocess) });

  await expect(registry.execute("bash", { command: "uname" }, new AbortController().signal))
    .resolves.toEqual({ output: "from-subprocess\n[exit code: 0]", isError: false });
  expect(spawned).toEqual([["bash", "-c", "uname"]]);
});

test("PowerShell 执行器使用单个 Command argv 并固定 UTF-8", async () => {
  const spawned: Array<{ argv: string[]; env?: Record<string, string> }> = [];
  const subprocess: SubprocessProvider = {
    async spawn(spec) {
      spawned.push({ argv: [...spec.argv], env: spec.env });
      return { exitCode: 0, signal: null, stdout: "你好", stderr: "", truncated: false };
    },
  };
  const provider = new LocalPowerShellProvider(subprocess, "pwsh.exe");
  const result = await provider.run({
    command: "Write-Output 你好",
    cwd: "C:\\work",
    signal: new AbortController().signal,
  });

  expect(result.stdout).toBe("你好");
  expect(spawned[0]?.argv.slice(0, 5)).toEqual([
    "pwsh.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
  ]);
  expect(spawned[0]?.argv[5]).toContain("[Console]::OutputEncoding");
  expect(spawned[0]?.argv[5]).toContain("Write-Output 你好");
  expect(spawned[0]?.env).not.toHaveProperty("TERM");
});

test("bash 工具源码不直接调用 Node 进程 API", async () => {
  const src = await readFile(new URL("../src/bash.ts", import.meta.url), "utf8");
  expect(src.includes("child_process")).toBe(false);
  expect(src.includes("spawn(")).toBe(false);
});
