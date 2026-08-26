import { Context, Service } from "@deepseek-ai/cordis";
import { ToolRegistry, type ToolDefinition } from "./tools.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    tools: ToolsService;
  }
}

export type SessionOwner = { source: string; sessionId: string };

export type ToolRegistryScope = {
  owner?: SessionOwner;
  exclude?: readonly string[];
};

/** 子 Agent / 后台 job 共用：禁止嵌套委派、写入、再开 job，以及改父会话目标。 */
export const CHILD_TOOL_EXCLUDE = [
  "subagent",
  "write_file",
  "job",
  "job_output",
  "job_kill",
  "tool-goal",
  "get_goal",
  "create_goal",
  "complete_goal",
] as const;

export type ToolContribution = (
  registry: ToolRegistry,
  workspaceRoot: string,
  scope?: ToolRegistryScope,
) => void | (() => void);

/** 工作区无关的工具贡献目录；每次请求按当前 Fiber 快照创建作用域 Registry。 */
export class ToolsService extends Service {
  private readonly contributions = new Map<string, ToolContribution>();

  constructor(ctx: Context) { super(ctx, "tools"); }

  register(id: string, contribution: ToolContribution): () => void {
    if (this.contributions.has(id)) throw new Error(`tool contribution already registered: ${id}`);
    this.contributions.set(id, contribution);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (this.contributions.get(id) === contribution) this.contributions.delete(id);
    };
  }

  createRegistry(workspaceRoot: string, scope: ToolRegistryScope = {}): ToolRegistry {
    const excluded = new Set(scope.exclude ?? []);
    const registry = new ToolRegistry();
    const register = registry.register.bind(registry);
    registry.register = (definition: ToolDefinition) => {
      if (excluded.has(definition.name)) return () => undefined;
      return register(definition);
    };
    for (const [id, contribution] of this.contributions) {
      if (excluded.has(id)) continue;
      contribution(registry, workspaceRoot, scope);
    }
    return registry;
  }

  entries(): string[] { return [...this.contributions.keys()]; }
}
