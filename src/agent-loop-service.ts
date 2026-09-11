import { Context, Service } from "@deepseek-ai/cordis";
import type { LlmClient } from "./llm.ts";
import { runTurn, type RunTurnOptions } from "./loop.ts";

declare module "@deepseek-ai/cordis" {
  interface Context { agentLoop: AgentLoopService }
}

export interface AgentLoop {
  run(path: string, llm: LlmClient, userText: string, options?: RunTurnOptions): Promise<void>;
}

export const defaultAgentLoop: AgentLoop = { run: runTurn };

/** Cordis 单轮执行能力；允许在装配边界替换 loop 实现。 */
export class AgentLoopService extends Service implements AgentLoop {
  constructor(ctx: Context, private readonly implementation: AgentLoop = defaultAgentLoop) {
    super(ctx, "agentLoop");
  }

  run(path: string, llm: LlmClient, userText: string, options?: RunTurnOptions): Promise<void> {
    return this.implementation.run(path, llm, userText, options);
  }
}
