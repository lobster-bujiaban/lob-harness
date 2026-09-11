import { ToolError, type ToolRegistry } from "./tools.ts";
import { throwIfAborted } from "./errors.ts";

export type JobStatus = "running" | "completed" | "killed" | "failed";

export type JobOwner = {
  source: string;
  sessionId: string;
  workspaceRoot: string;
};

export type JobStartRequest = {
  parentSessionId: string;
  source: string;
  workspaceRoot: string;
  prompt: string;
  signal: AbortSignal;
};

export type JobSnapshot = {
  jobId: string;
  status: JobStatus;
  output: string;
};

export interface JobRuntime {
  start(request: JobStartRequest): Promise<{ jobId: string }>;
  output(jobId: string, parentSessionId: string): Promise<JobSnapshot>;
  kill(jobId: string, parentSessionId: string): Promise<JobSnapshot & { requested: boolean }>;
  wait(jobId: string, parentSessionId: string): Promise<JobSnapshot>;
}

export function renderJobStart(jobId: string): string {
  return `started job ${jobId}\n[status: running]`;
}

export function renderJobOutput(snapshot: JobSnapshot): string {
  const body = snapshot.output.trim().length === 0
    ? snapshot.status === "running" ? "(no output yet)" : "(no output)"
    : snapshot.output;
  return `${body}\n[status: ${snapshot.status}]`;
}

export function renderJobKill(snapshot: JobSnapshot, requested: boolean): string {
  return requested
    ? `requested cancellation of job ${snapshot.jobId}\n[status: ${snapshot.status}]`
    : `job ${snapshot.jobId} already finished\n[status: ${snapshot.status}]`;
}

export function installJobs(
  registry: ToolRegistry,
  options: { jobs: JobRuntime; owner: JobOwner },
): () => void {
  const disposeStart = registry.register({
    name: "job",
    description: "在后台启动一个子 Agent，立即返回 jobId。用 job_output 查看状态和结果，不要同步等待。",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "交给后台 Agent 的任务" },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    executionMode: { kind: "exclusive" },
    async execute(args, context) {
      throwIfAborted(context.signal);
      const result = await options.jobs.start({
        parentSessionId: options.owner.sessionId,
        source: options.owner.source,
        workspaceRoot: options.owner.workspaceRoot,
        prompt: parsePrompt(args),
        signal: context.signal,
      });
      return renderJobStart(result.jobId);
    },
  });

  const disposeOutput = registry.register({
    name: "job_output",
    description: "读取后台 job 的当前状态和最终输出。运行中不会阻塞。",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "job 返回的 id" },
      },
      required: ["jobId"],
      additionalProperties: false,
    },
    executionMode: { kind: "parallel" },
    async execute(args, context) {
      throwIfAborted(context.signal);
      return renderJobOutput(await options.jobs.output(parseJobId(args), options.owner.sessionId));
    },
  });

  const disposeKill = registry.register({
    name: "job_kill",
    description: "取消仍在运行的后台 job。",
    parameters: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "job 返回的 id" },
      },
      required: ["jobId"],
      additionalProperties: false,
    },
    executionMode: { kind: "exclusive" },
    async execute(args, context) {
      throwIfAborted(context.signal);
      const result = await options.jobs.kill(parseJobId(args), options.owner.sessionId);
      return renderJobKill(result, result.requested);
    },
  });

  return () => {
    disposeKill();
    disposeOutput();
    disposeStart();
  };
}

function parsePrompt(args: unknown): string {
  if (typeof args !== "object" || args === null || !("prompt" in args)) {
    throw new ToolError("job prompt required", "JOB_INVALID_ARGS");
  }
  const prompt = String((args as { prompt: unknown }).prompt).trim();
  if (prompt.length === 0) throw new ToolError("job prompt required", "JOB_INVALID_ARGS");
  return prompt;
}

function parseJobId(args: unknown): string {
  if (typeof args !== "object" || args === null || !("jobId" in args)) {
    throw new ToolError("jobId required", "JOB_INVALID_ARGS");
  }
  const jobId = String((args as { jobId: unknown }).jobId).trim();
  if (jobId.length === 0) throw new ToolError("jobId required", "JOB_INVALID_ARGS");
  return jobId;
}
