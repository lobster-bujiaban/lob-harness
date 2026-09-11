import { Context, Service } from "@deepseek-ai/cordis";
import {
  Agent,
  type AgentEvent,
  type AgentPreStep,
  type AgentRequestError,
} from "./agent.ts";
import type { ContextBudget } from "./context.ts";
import { createRetryPolicy } from "./retry.ts";

declare module "@deepseek-ai/cordis" {
  interface Events {
    "agent/pre-step"(payload: Parameters<AgentPreStep>[0], next: () => ReturnType<AgentPreStep>): ReturnType<AgentPreStep>;
    "agent/request-error"(payload: Parameters<AgentRequestError>[0], next: () => ReturnType<AgentRequestError>): ReturnType<AgentRequestError>;
  }
}

declare module "@deepseek-ai/cordis" {
  interface Context { agents: AgentService }
}

export type AgentCreateOptions = {
  source: string;
  id: string;
  workspaceRoot: string;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
  toolExclude?: readonly string[];
};

/** 统一 Agent 依赖装配、单会话互斥、停止与卸载清理。 */
export class AgentService extends Service {
  static inject = ["sessions", "llm", "tools", "systemPrompt", "agentLoop"];
  private readonly active = new Map<string, Agent>();
  private readonly retry = createRetryPolicy();

  constructor(ctx: Context, private readonly contextBudget: ContextBudget) {
    super(ctx, "agents");
    ctx.effect(() => () => {
      for (const agent of this.active.values()) agent.cancel({ kind: "shutdown" });
      this.active.clear();
    });
  }

  create(options: AgentCreateOptions): Agent {
    const key = this.key(options.source, options.id);
    if (this.active.has(key)) throw Object.assign(new Error("session already running"), { code: "AGENT_BUSY" });
    const agent = new Agent(options.id, (prompt) => this.ctx.llm.create(prompt), options.onEvent, {
      persistence: this.ctx.sessions.get(options.source),
      toolRegistry: this.ctx.tools.createRegistry(options.workspaceRoot, {
        owner: { source: options.source, sessionId: options.id },
        exclude: options.toolExclude,
      }),
      systemPrompts: this.ctx.systemPrompt,
      contextBudget: this.contextBudget,
      agentLoop: this.ctx.agentLoop,
      preStep: (payload) => this.ctx.waterfall(
        "agent/pre-step",
        payload,
        () => ({ kind: "enter", messages: [...payload.messages] }),
      ),
      requestError: (payload) => this.ctx.waterfall(
        "agent/request-error",
        payload,
        () => this.retry(payload),
      ),
    });
    this.active.set(key, agent);
    return agent;
  }

  get(source: string, id: string): Agent | undefined { return this.active.get(this.key(source, id)); }

  release(source: string, id: string, agent: Agent): void {
    const key = this.key(source, id);
    if (this.active.get(key) === agent) this.active.delete(key);
  }

  async stop(source: string, id: string): Promise<boolean> {
    const agent = this.get(source, id);
    if (agent === undefined || agent.status !== "running") return false;
    agent.cancel({ kind: "user" });
    await agent.whenIdle();
    return true;
  }

  private key(source: string, id: string): string { return `${source}/${id}`; }
}
