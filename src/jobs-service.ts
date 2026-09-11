import { randomUUID } from "node:crypto";
import { Context, Service } from "@deepseek-ai/cordis";
import type { Agent } from "./agent.ts";
import { ToolError } from "./tools.ts";
import { throwIfAborted } from "./errors.ts";
import { lastAssistantOutput } from "./subagent.ts";
import { CHILD_TOOL_EXCLUDE } from "./tools-service.ts";
import type { JobRuntime, JobSnapshot, JobStartRequest, JobStatus } from "./jobs.ts";

declare module "@deepseek-ai/cordis" {
  interface Context { jobs: JobsService }
}

type JobRecord = {
  jobId: string;
  parentSessionId: string;
  source: string;
  status: JobStatus;
  output: string;
  agent?: Agent;
  settled: Promise<void>;
  resolveSettled: () => void;
};

/** 进程内后台 job：启动子 Agent 后立即返回，状态在独立会话日志。 */
export class JobsService extends Service implements JobRuntime {
  static inject = ["sessions", "agents", "tools"];
  private readonly jobs = new Map<string, JobRecord>();

  constructor(ctx: Context) {
    super(ctx, "jobs");
    ctx.effect(() => () => {
      for (const record of this.jobs.values()) {
        if (record.status !== "running") continue;
        record.status = "killed";
        record.agent?.cancel({ kind: "shutdown" });
      }
    });
  }

  async start(request: JobStartRequest): Promise<{ jobId: string }> {
    throwIfAborted(request.signal);
    const jobId = `job-${randomUUID()}.jsonl`;
    const store = this.ctx.sessions.get(request.source);
    await store.create(jobId);
    await store.append(jobId, {
      type: "job_descriptor",
      parentSessionId: request.parentSessionId,
      prompt: request.prompt,
    });
    await store.append(request.parentSessionId, {
      type: "job_started",
      jobId,
      prompt: request.prompt,
    });
    const agent = this.ctx.agents.create({
      source: request.source,
      id: jobId,
      workspaceRoot: request.workspaceRoot,
      toolExclude: CHILD_TOOL_EXCLUDE,
    });
    let resolveSettled: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const record: JobRecord = {
      jobId,
      parentSessionId: request.parentSessionId,
      source: request.source,
      status: "running",
      output: "",
      agent,
      settled,
      resolveSettled,
    };
    this.jobs.set(jobId, record);
    try {
      await agent.followup(request.prompt);
    } catch (error) {
      this.jobs.delete(jobId);
      this.ctx.agents.release(request.source, jobId, agent);
      record.resolveSettled();
      throw error;
    }
    void this.settle(record);
    return { jobId };
  }

  async output(jobId: string, parentSessionId: string): Promise<JobSnapshot> {
    return snapshotOf(this.requireOwned(jobId, parentSessionId));
  }

  async kill(jobId: string, parentSessionId: string): Promise<JobSnapshot & { requested: boolean }> {
    const record = this.requireOwned(jobId, parentSessionId);
    if (record.status !== "running") return { ...snapshotOf(record), requested: false };
    record.status = "killed";
    record.agent?.cancel({ kind: "user" });
    await record.settled;
    return { ...snapshotOf(record), requested: true };
  }

  async wait(jobId: string, parentSessionId: string): Promise<JobSnapshot> {
    const record = this.requireOwned(jobId, parentSessionId);
    await record.settled;
    return snapshotOf(record);
  }

  private async settle(record: JobRecord): Promise<void> {
    const store = this.ctx.sessions.get(record.source);
    try {
      if (record.agent !== undefined) await record.agent.whenIdle();
      if (record.status === "killed") {
        record.output = lastAssistantOutput(await store.load(record.jobId));
      } else if (record.agent?.error !== undefined) {
        record.status = "failed";
        record.output = record.agent.error instanceof Error
          ? record.agent.error.message
          : String(record.agent.error);
      } else {
        record.status = "completed";
        record.output = lastAssistantOutput(await store.load(record.jobId));
      }
    } catch (error) {
      if (record.status === "running") {
        record.status = "failed";
        record.output = error instanceof Error ? error.message : String(error);
      }
    } finally {
      const status = record.status === "running" ? "failed" : record.status;
      record.status = status;
      await store.append(record.parentSessionId, {
        type: "job_ended",
        jobId: record.jobId,
        status,
        output: record.output,
      }).catch(() => undefined);
      if (record.agent !== undefined) {
        this.ctx.agents.release(record.source, record.jobId, record.agent);
        record.agent = undefined;
      }
      record.resolveSettled();
    }
  }

  private requireOwned(jobId: string, parentSessionId: string): JobRecord {
    const record = this.jobs.get(jobId);
    if (record === undefined) throw new ToolError(`job not found: ${jobId}`, "JOB_NOT_FOUND");
    if (record.parentSessionId !== parentSessionId) {
      throw new ToolError("job parent mismatch", "JOB_UNAUTHORIZED");
    }
    return record;
  }
}

function snapshotOf(record: JobRecord): JobSnapshot {
  return { jobId: record.jobId, status: record.status, output: record.output };
}
