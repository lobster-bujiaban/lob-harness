import { expect, test } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutomaticApprovalProvider } from "../src/approval.ts";
import { ToolRegistry } from "../src/tools.ts";
import { FakeLlm } from "../src/llm.ts";
import { runTurn } from "../src/loop.ts";
import { load } from "../src/session.ts";

function approvalRegistry() {
  const registry = new ToolRegistry();
  let bodyRuns = 0;
  registry.register({
    name: "danger",
    description: "需要审批的操作",
    parameters: {
      type: "object",
      properties: { action: { type: "string" } },
      required: ["action"],
      additionalProperties: false,
    },
    executionMode: { kind: "exclusive" },
    execute() {
      bodyRuns += 1;
      return "executed";
    },
  });
  registry.onPreExecute((execution, next) => execution.name === "danger"
    ? { kind: "ask", reason: "dangerous action" }
    : next());
  return { registry, bodyRuns: () => bodyRuns };
}

test("自动允许 Provider 只放行当前 ask，并收到完整请求", async () => {
  const { registry, bodyRuns } = approvalRegistry();
  const requests: Array<Record<string, unknown>> = [];
  registry.provideApproval({
    request(request) {
      const { signal: _signal, ...snapshot } = request;
      requests.push(structuredClone(snapshot));
      return "allowed-once";
    },
  });

  await expect(registry.execute(
    "danger",
    { action: "deploy" },
    new AbortController().signal,
    "call-1",
  )).resolves.toEqual({ output: "executed", isError: false });
  expect(bodyRuns()).toBe(1);
  expect(requests[0]).toMatchObject({
    callId: "call-1",
    toolName: "danger",
    arguments: { action: "deploy" },
    reason: "dangerous action",
  });
});

test("自动拒绝、取消和不可用 Provider 均失败关闭并跳过主体", async () => {
  for (const outcome of ["rejected", "cancelled", "unavailable"] as const) {
    const { registry, bodyRuns } = approvalRegistry();
    registry.provideApproval(new AutomaticApprovalProvider(outcome));

    const result = await registry.execute(
      "danger",
      { action: outcome },
      new AbortController().signal,
    );

    expect(bodyRuns()).toBe(0);
    expect(result).toMatchObject({ isError: true, error: { code: "DENIED" } });
  }
});

test("缺少、抛错或返回非法值的审批通道均归一为 unavailable", async () => {
  const providers = [
    undefined,
    { request: () => { throw new Error("channel failed"); } },
    { request: () => "allow-always" as never },
  ];
  for (const provider of providers) {
    const { registry, bodyRuns } = approvalRegistry();
    if (provider !== undefined) registry.provideApproval(provider);

    const result = await registry.execute("danger", {}, new AbortController().signal);

    expect(bodyRuns()).toBe(0);
    expect(result.output).toContain("no approval channel is available");
    expect(result).toMatchObject({ isError: true, error: { code: "DENIED" } });
  }
});

test("Approval Provider 单槽注册并支持幂等卸载", () => {
  const registry = new ToolRegistry();
  const provider = new AutomaticApprovalProvider("allowed-once");
  const dispose = registry.provideApproval(provider);
  expect(() => registry.provideApproval(provider)).toThrow("already registered");
  dispose();
  dispose();
  expect(() => registry.provideApproval(provider)).not.toThrow();
});

test("ask 在开放 turn 内持久记录配对的审批审计事件", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "tiny-harness-approval-")), "session.jsonl");
  const { registry } = approvalRegistry();
  registry.provideApproval(new AutomaticApprovalProvider("rejected"));
  const llm = new FakeLlm([
    { kind: "tool", calls: [{ id: "danger-1", name: "danger", args: { action: "deploy" } }] },
    { kind: "text", text: "审批未通过" },
  ]);

  await runTurn(path, llm, "执行危险操作", { toolRegistry: registry });

  const events = await load(path);
  const asked = events.find((event) => event.type === "approval_asked");
  const decided = events.find((event) => event.type === "approval_decided");
  expect(asked).toMatchObject({
    type: "approval_asked",
    callId: "danger-1",
    toolName: "danger",
    reason: "dangerous action",
  });
  expect(decided).toEqual({
    type: "approval_decided",
    id: asked?.type === "approval_asked" ? asked.id : "missing",
    outcome: "rejected",
  });
  expect(events.find((event) => event.type === "tool_result")).toMatchObject({
    isError: true,
    error: { code: "DENIED" },
  });
});
