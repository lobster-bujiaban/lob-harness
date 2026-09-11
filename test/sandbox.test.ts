import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { installBash } from "../src/bash.ts";
import { SandboxBashProvider, SandboxPowerShellProvider } from "../src/shell-service.ts";
import type { SubprocessProvider, SubprocessResult } from "../src/subprocess-service.ts";
import {
  LocalSandboxProvider,
  probeSeatbelt,
  type ConfinedArgv,
  type SandboxBackend,
  type SandboxPolicy,
} from "../src/sandbox-service.ts";
import { ToolError, ToolRegistry } from "../src/tools.ts";

const idle: SubprocessResult = {
  exitCode: 0,
  signal: null,
  stdout: "ok",
  stderr: "",
  truncated: false,
};

test("sandbox 在 spawn 前包装 argv，danger-full-access 不包装", async () => {
  const spawned: string[][] = [];
  const subprocess: SubprocessProvider = {
    async spawn(spec) {
      spawned.push([...spec.argv]);
      return idle;
    },
  };
  const sandbox: SandboxBackend = {
    confine(argv, policy) {
      return {
        argv: ["wrap", policy.mode, ...argv],
        enforcement: "full",
        denialSignatures: ["SANDBOX_DENIED"],
      };
    },
  };
  const provider = new SandboxBashProvider(subprocess, sandbox, {
    mode: "read-only",
    workspaceRoot: "/virtual",
  });

  await provider.run({ command: "uname", cwd: "/virtual", signal: new AbortController().signal });
  expect(spawned).toEqual([["wrap", "read-only", "bash", "-c", "uname"]]);

  spawned.length = 0;
  await provider.run({
    command: "uname",
    cwd: "/virtual",
    signal: new AbortController().signal,
    sandboxPolicy: { mode: "danger-full-access", workspaceRoot: "/virtual" },
  });
  expect(spawned).toEqual([["bash", "-c", "uname"]]);
});

test("受限模式没有可用后端时失败关闭，不会裸跑原 argv", async () => {
  let spawned = 0;
  const subprocess: SubprocessProvider = {
    async spawn() {
      spawned += 1;
      return idle;
    },
  };
  const sandbox: SandboxBackend = {
    confine() {
      throw new ToolError("no backend", "SANDBOX_UNAVAILABLE");
    },
  };
  const registry = new ToolRegistry();
  installBash(registry, {
    root: "/virtual",
    provider: new SandboxBashProvider(subprocess, sandbox, {
      mode: "workspace-write",
      workspaceRoot: "/virtual",
    }),
    policy: { mode: "workspace-write", workspaceRoot: "/virtual" },
  });

  const result = await registry.execute("bash", { command: "uname" }, new AbortController().signal);
  expect(result).toMatchObject({ isError: true, error: { code: "SANDBOX_UNAVAILABLE" } });
  expect(spawned).toBe(0);
});

test("Windows PowerShell 仅在 danger-full-access 下绕过缺失的沙箱", async () => {
  const spawned: string[][] = [];
  const subprocess: SubprocessProvider = {
    async spawn(spec) {
      spawned.push([...spec.argv]);
      return idle;
    },
  };
  const sandbox: SandboxBackend = {
    confine() {
      throw new ToolError("no Windows backend", "SANDBOX_UNAVAILABLE");
    },
  };
  const provider = new SandboxPowerShellProvider(
    subprocess,
    sandbox,
    { mode: "workspace-write", workspaceRoot: "C:\\work" },
    "pwsh.exe",
  );

  await expect(provider.run({
    command: "Get-ChildItem",
    cwd: "C:\\work",
    signal: new AbortController().signal,
  })).rejects.toMatchObject({ code: "SANDBOX_UNAVAILABLE" });
  expect(spawned).toEqual([]);

  const result = await provider.run({
    command: "Get-ChildItem",
    cwd: "C:\\work",
    signal: new AbortController().signal,
    sandboxPolicy: { mode: "danger-full-access", workspaceRoot: "C:\\work" },
  });
  expect(result.sandbox).toEqual({ mode: "danger-full-access", denied: false, enforcement: "none" });
  expect(spawned[0]?.[0]).toBe("pwsh.exe");
});

test("sandbox 拒绝是可回放结果，不是基础设施失败", async () => {
  const sandbox: SandboxBackend = {
    confine(argv): ConfinedArgv {
      return { argv: [...argv], enforcement: "full", denialSignatures: ["SANDBOX_DENIED"] };
    },
  };
  const subprocess: SubprocessProvider = {
    async spawn() {
      return { ...idle, exitCode: 1, stdout: "", stderr: "SANDBOX_DENIED: write blocked" };
    },
  };
  const registry = new ToolRegistry();
  installBash(registry, {
    root: "/virtual",
    provider: new SandboxBashProvider(subprocess, sandbox, {
      mode: "read-only",
      workspaceRoot: "/virtual",
    }),
    policy: { mode: "read-only", workspaceRoot: "/virtual" },
  });

  const result = await registry.execute("bash", { command: "echo x > file" }, new AbortController().signal);
  expect(result.isError).toBe(false);
  expect(result.output).toContain("[sandbox: file access denied under read-only mode]");
  expect(result.output).toContain("[exit code: 1]");
});

test("策略按调用传入，工具实现不出现具体 mode 分支", async () => {
  const policies: SandboxPolicy[] = [];
  const sandbox: SandboxBackend = {
    confine(argv, policy) {
      policies.push(policy);
      return { argv: [...argv], enforcement: "full", denialSignatures: [] };
    },
  };
  const subprocess: SubprocessProvider = { async spawn() { return idle; } };
  const provider = new SandboxBashProvider(subprocess, sandbox, {
    mode: "read-only",
    workspaceRoot: "/virtual",
  });
  await provider.run({
    command: "true",
    cwd: "/virtual",
    signal: new AbortController().signal,
    sandboxPolicy: { mode: "workspace-write", workspaceRoot: "/other" },
  });
  expect(policies).toEqual([{ mode: "workspace-write", workspaceRoot: "/other" }]);

  const src = await readFile(new URL("../src/bash.ts", import.meta.url), "utf8");
  expect(src.includes("read-only")).toBe(false);
  expect(src.includes("workspace-write")).toBe(false);
});

const seatbelt = probeSeatbelt();

test.skipIf(!seatbelt)("Seatbelt 允许工作区内写入，拒绝工作区外写入", async () => {
  const root = await mkdtemp(join(tmpdir(), "tiny-harness-seatbelt-"));
  await mkdir(join(root, "nested"));
  const outside = join(root, "..", `escape-${Date.now()}.txt`);
  const subprocess = new (await import("../src/subprocess-service.ts")).LocalSubprocessProvider();
  const provider = new SandboxBashProvider(subprocess, new LocalSandboxProvider(), {
    mode: "workspace-write",
    workspaceRoot: root,
  });
  const registry = new ToolRegistry();
  installBash(registry, {
    root,
    provider,
    policy: { mode: "workspace-write", workspaceRoot: root },
  });

  const inside = await registry.execute(
    "bash",
    { command: "printf in > nested/out.txt && cat nested/out.txt" },
    new AbortController().signal,
  );
  expect(inside.isError).toBe(false);
  expect(inside.output).toContain("in");
  expect(await readFile(join(root, "nested", "out.txt"), "utf8")).toBe("in");

  const denied = await registry.execute(
    "bash",
    { command: `printf out > ${JSON.stringify(outside)}` },
    new AbortController().signal,
  );
  expect(denied.isError).toBe(false);
  expect(denied.output).toContain("[sandbox: file access denied under workspace-write mode]");
  await expect(readFile(outside, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});

test.skipIf(!seatbelt)("read-only 连工作区内写入也拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "tiny-harness-readonly-"));
  await writeFile(join(root, "keep.txt"), "keep", "utf8");
  const subprocess = new (await import("../src/subprocess-service.ts")).LocalSubprocessProvider();
  const registry = new ToolRegistry();
  installBash(registry, {
    root,
    provider: new SandboxBashProvider(subprocess, new LocalSandboxProvider(), {
      mode: "read-only",
      workspaceRoot: root,
    }),
    policy: { mode: "read-only", workspaceRoot: root },
  });

  const denied = await registry.execute(
    "bash",
    { command: "printf x > keep.txt" },
    new AbortController().signal,
  );
  expect(denied.output).toContain("[sandbox: file access denied under read-only mode]");
  expect(await readFile(join(root, "keep.txt"), "utf8")).toBe("keep");
});
