import { installBash } from "./bash.ts";
import { installReadFile } from "./files.ts";
import { LocalFsProvider } from "./fs-service.ts";
import { SandboxBashProvider } from "./shell-service.ts";
import { LocalSubprocessProvider } from "./subprocess-service.ts";
import { LocalSandboxProvider } from "./sandbox-service.ts";
import { createDefaultToolRegistry } from "./tools.ts";

export function createWorkspaceToolRegistry(root = process.cwd()) {
  const registry = createDefaultToolRegistry();
  installReadFile(registry, { root, provider: new LocalFsProvider() });
  const subprocess = new LocalSubprocessProvider();
  const policy = { mode: "workspace-write" as const, workspaceRoot: root };
  installBash(registry, {
    root,
    provider: new SandboxBashProvider(subprocess, new LocalSandboxProvider(), policy),
    policy,
  });
  return registry;
}

export const defaultToolRegistry = createWorkspaceToolRegistry();
