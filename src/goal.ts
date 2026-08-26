import { ToolError, type ToolRegistry } from "./tools.ts";
import { throwIfAborted } from "./errors.ts";
import type { SessionEvent } from "./session.ts";

export type GoalPhase = "active" | "completed";
export type GoalAction = "create" | "complete";

export type GoalSnapshot = {
  id: string;
  revision: number;
  objective: string;
  phase: GoalPhase;
};

export type GoalOwner = {
  source: string;
  sessionId: string;
};

export interface GoalRuntime {
  get(source: string, sessionId: string): Promise<GoalSnapshot | null>;
  create(source: string, sessionId: string, objective: string, signal?: AbortSignal): Promise<GoalSnapshot>;
  complete(source: string, sessionId: string, signal?: AbortSignal): Promise<GoalSnapshot>;
}

/** 当前目标只由 goal_change 折叠得出，不另存一份运行时权威状态。 */
export function deriveGoal(events: readonly SessionEvent[]): GoalSnapshot | null {
  let current: GoalSnapshot | null = null;
  for (const event of events) {
    if (event.type === "goal_change") current = event.goal;
  }
  return current;
}

export function renderGoal(goal: GoalSnapshot | null): string {
  return JSON.stringify({ goal });
}

export function installGoal(
  registry: ToolRegistry,
  options: { goals: GoalRuntime; owner: GoalOwner },
): () => void {
  const disposeGet = registry.register({
    name: "get_goal",
    description: "读取当前会话的持久目标。没有目标时返回 {\"goal\":null}。",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    executionMode: { kind: "parallel" },
    async execute(_args, context) {
      throwIfAborted(context.signal);
      return renderGoal(await options.goals.get(options.owner.source, options.owner.sessionId));
    },
  });

  const disposeCreate = registry.register({
    name: "create_goal",
    description: "在当前会话挂一个待完成目标。已有未完成目标时会失败；已完成目标可被替换。",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string", description: "要完成的目标描述" },
      },
      required: ["objective"],
      additionalProperties: false,
    },
    executionMode: { kind: "exclusive" },
    async execute(args, context) {
      throwIfAborted(context.signal);
      return renderGoal(await options.goals.create(
        options.owner.source,
        options.owner.sessionId,
        parseObjective(args),
        context.signal,
      ));
    },
  });

  const disposeComplete = registry.register({
    name: "complete_goal",
    description: "把当前活跃目标标记为已完成。状态写进会话日志，不另存变量。",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    executionMode: { kind: "exclusive" },
    async execute(_args, context) {
      throwIfAborted(context.signal);
      return renderGoal(await options.goals.complete(
        options.owner.source,
        options.owner.sessionId,
        context.signal,
      ));
    },
  });

  return () => {
    disposeComplete();
    disposeCreate();
    disposeGet();
  };
}

function parseObjective(args: unknown): string {
  if (typeof args !== "object" || args === null || !("objective" in args)) {
    throw new ToolError("goal objective required", "GOAL_INVALID_ARGS");
  }
  const objective = String((args as { objective: unknown }).objective).trim();
  if (objective.length === 0) throw new ToolError("goal objective required", "GOAL_INVALID_ARGS");
  return objective;
}
