import { randomUUID } from "node:crypto";
import { Context, Service } from "@deepseek-ai/cordis";
import { ToolError } from "./tools.ts";
import { throwIfAborted } from "./errors.ts";
import type { SessionEvent } from "./session.ts";
import type { SessionPersistence } from "./session-persistence.ts";
import { CHILD_TOOL_EXCLUDE } from "./tools-service.ts";
import {
  lastAssistantOutput,
  subagentDescriptorOf,
  type SubagentFollowupRequest,
  type SubagentRuntime,
  type SubagentRunResult,
  type SubagentStartRequest,
} from "./subagent.ts";

declare module "@deepseek-ai/cordis" {
  interface Context { subagents: SubagentService }
}

/** 进程内可继续子 Agent：状态在子会话日志，父级只记归属事件与工具结果。 */
export class SubagentService extends Service implements SubagentRuntime {
  static inject = ["sessions", "agents", "tools"];

  constructor(ctx: Context) {
    super(ctx, "subagents");
  }

  async start(request: SubagentStartRequest): Promise<SubagentRunResult> {
    throwIfAborted(request.signal);
    const childId = `child-${randomUUID()}.jsonl`;
    const store = this.ctx.sessions.get(request.source);
    await store.create(childId);
    await store.append(childId, {
      type: "subagent_descriptor",
      parentSessionId: request.parentSessionId,
      mode: "continuable",
    });
    await store.append(request.parentSessionId, {
      type: "subagent_started",
      childId,
      prompt: request.prompt,
    });
    const output = await this.runChild(request, childId);
    await store.append(request.parentSessionId, {
      type: "subagent_ended",
      childId,
      output,
    });
    return { childId, output, continued: false };
  }

  async followup(request: SubagentFollowupRequest): Promise<SubagentRunResult> {
    throwIfAborted(request.signal);
    const store = this.ctx.sessions.get(request.source);
    const events = await loadOrMissing(store, request.childId);
    if (events === undefined) throw new ToolError(`subagent not found: ${request.childId}`, "SUBAGENT_NOT_FOUND");
    const descriptor = subagentDescriptorOf(events);
    if (descriptor === undefined) throw new ToolError(`subagent not found: ${request.childId}`, "SUBAGENT_NOT_FOUND");
    if (descriptor.parentSessionId !== request.parentSessionId) {
      throw new ToolError("subagent parent mismatch", "SUBAGENT_UNAUTHORIZED");
    }
    if (this.ctx.agents.get(request.source, request.childId) !== undefined) {
      throw new ToolError("subagent is busy", "SUBAGENT_BUSY");
    }
    await store.append(request.parentSessionId, {
      type: "subagent_started",
      childId: request.childId,
      prompt: request.prompt,
    });
    const output = await this.runChild(request, request.childId);
    await store.append(request.parentSessionId, {
      type: "subagent_ended",
      childId: request.childId,
      output,
    });
    return { childId: request.childId, output, continued: true };
  }

  private async runChild(request: SubagentStartRequest, childId: string): Promise<string> {
    const agent = this.ctx.agents.create({
      source: request.source,
      id: childId,
      workspaceRoot: request.workspaceRoot,
      toolExclude: CHILD_TOOL_EXCLUDE,
    });
    const onAbort = () => agent.cancel({ kind: "user" });
    request.signal.addEventListener("abort", onAbort, { once: true });
    try {
      await agent.followup(request.prompt);
      await agent.whenIdle();
      throwIfAborted(request.signal);
      if (agent.error !== undefined) {
        throw agent.error instanceof Error
          ? agent.error
          : new ToolError(String(agent.error), "SUBAGENT_FAILED");
      }
      return lastAssistantOutput(await this.ctx.sessions.get(request.source).load(childId));
    } finally {
      request.signal.removeEventListener("abort", onAbort);
      this.ctx.agents.release(request.source, childId, agent);
    }
  }
}

async function loadOrMissing(store: SessionPersistence, id: string): Promise<SessionEvent[] | undefined> {
  try {
    return await store.load(id);
  } catch (error) {
    if (
      typeof error === "object" && error !== null && "code" in error
      && (error as { code?: unknown }).code === "ENOENT"
    ) return undefined;
    throw error;
  }
}
