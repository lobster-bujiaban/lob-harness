import { randomUUID } from "node:crypto";
import { Context, Service } from "@deepseek-ai/cordis";
import { ToolError } from "./tools.ts";
import { throwIfAborted } from "./errors.ts";
import { deriveGoal, type GoalRuntime, type GoalSnapshot } from "./goal.ts";

declare module "@deepseek-ai/cordis" {
  interface Context { goals: GoalsService }
}

/** 同会话目标：每次变更追加 goal_change，读取时从日志折叠。 */
export class GoalsService extends Service implements GoalRuntime {
  static inject = ["sessions"];

  constructor(ctx: Context) {
    super(ctx, "goals");
  }

  async get(source: string, sessionId: string): Promise<GoalSnapshot | null> {
    return deriveGoal(await this.ctx.sessions.get(source).load(sessionId));
  }

  async create(
    source: string,
    sessionId: string,
    objective: string,
    signal?: AbortSignal,
  ): Promise<GoalSnapshot> {
    throwIfAborted(signal);
    const current = await this.get(source, sessionId);
    if (current?.phase === "active") {
      throw new ToolError("active goal already exists", "GOAL_ALREADY_ACTIVE");
    }
    const goal: GoalSnapshot = {
      id: `goal-${randomUUID()}`,
      revision: 1,
      objective,
      phase: "active",
    };
    await this.ctx.sessions.get(source).append(sessionId, {
      type: "goal_change",
      action: "create",
      goal,
    });
    return goal;
  }

  async complete(source: string, sessionId: string, signal?: AbortSignal): Promise<GoalSnapshot> {
    throwIfAborted(signal);
    const current = await this.get(source, sessionId);
    if (current === null || current.phase !== "active") {
      throw new ToolError("no active goal", "GOAL_NOT_ACTIVE");
    }
    const goal: GoalSnapshot = {
      ...current,
      revision: current.revision + 1,
      phase: "completed",
    };
    await this.ctx.sessions.get(source).append(sessionId, {
      type: "goal_change",
      action: "complete",
      goal,
    });
    return goal;
  }
}
