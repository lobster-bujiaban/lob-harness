import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { FakeLlm, type LlmClient, type ToolSchema } from "../src/llm.ts";
import { runTurn } from "../src/loop.ts";
import { load } from "../src/session.ts";
import { ToolRegistry, createDefaultToolRegistry } from "../src/tools.ts";

test("日志顺序是 user → tool_call → tool_result → assistant", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tiny-harness-"));
  const path = join(dir, "session.jsonl");
  const llm = new FakeLlm([
    {
      kind: "tool",
      calls: [{ id: "1", name: "echo", args: { text: "hi" } }],
    },
    { kind: "text", text: "已经 echo 了 hi" },
  ]);

  await runTurn(path, llm, "用 echo 说 hi");

  expect(await load(path)).toEqual([
    { type: "turn_start", turn: 1 },
    { type: "step_start", turn: 1, step: 1 },
    { type: "user", text: "用 echo 说 hi" },
    { type: "request_start", turn: 1, step: 1, attempt: 1 },
    {
      type: "request_end",
      turn: 1,
      step: 1,
      attempt: 1,
      reason: { kind: "completed" },
    },
    { type: "tool_call", id: "1", name: "echo", args: { text: "hi" } },
    { type: "tool_result", id: "1", name: "echo", output: "hi" },
    { type: "step_end", turn: 1, step: 1 },
    { type: "step_start", turn: 1, step: 2 },
    { type: "request_start", turn: 1, step: 2, attempt: 1 },
    {
      type: "request_end",
      turn: 1,
      step: 2,
      attempt: 1,
      reason: { kind: "completed" },
    },
    { type: "assistant", text: "已经 echo 了 hi" },
    { type: "step_end", turn: 1, step: 2 },
    { type: "turn_end", turn: 1, reason: { kind: "completed" } },
  ]);
});

test("工具执行观察调用方的 AbortSignal", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("cancelled", "AbortError"));

  await expect(createDefaultToolRegistry().execute(
    "echo",
    { text: "不应执行" },
    controller.signal,
  )).rejects.toThrow("operation aborted");
});

test("注册新工具无需修改 Loop，schema 和 executor 来自同一定义", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tiny-harness-registry-"));
  const path = join(dir, "session.jsonl");
  const registry = new ToolRegistry();
  registry.register({
    name: "upper",
    description: "转换为大写",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    executionMode: { kind: "parallel" },
    execute(args) {
      return String((args as { text: unknown }).text).toUpperCase();
    },
  });
  const seenSchemas: ToolSchema[][] = [];
  let request = 0;
  const llm: LlmClient = {
    async complete(_messages, schemas) {
      seenSchemas.push(structuredClone(schemas));
      request += 1;
      return request === 1
        ? { kind: "tool", calls: [{ id: "u1", name: "upper", args: { text: "hello" } }] }
        : { kind: "text", text: "完成" };
    },
  };

  await runTurn(path, llm, "大写 hello", { toolRegistry: registry });

  expect(seenSchemas[0]).toEqual([{
    name: "upper",
    description: "转换为大写",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  }]);
  expect((await load(path)).find((event) => event.type === "tool_result")).toEqual({
    type: "tool_result",
    id: "u1",
    name: "upper",
    output: "HELLO",
  });
});

test("register 返回幂等 disposer，并拒绝同名定义", async () => {
  const registry = new ToolRegistry();
  const definition = {
    name: "sample",
    description: "示例",
    parameters: { type: "object" },
    executionMode: { kind: "exclusive" as const },
    execute: () => "ok",
  };
  const dispose = registry.register(definition);

  expect(registry.get("sample")?.executionMode).toEqual({ kind: "exclusive" });
  expect(() => registry.register(definition)).toThrow("already registered");
  dispose();
  dispose();
  expect(registry.get("sample")).toBeUndefined();
  expect(await registry.execute("sample", {}, new AbortController().signal))
    .toEqual({
      output: "error: unknown tool: sample",
      isError: true,
      error: { message: "unknown tool: sample", code: "UNKNOWN_TOOL" },
    });
});

test("preExecute → execute → postExecute 按 waterfall 顺序包装工具主体", async () => {
  const registry = new ToolRegistry();
  const order: string[] = [];
  registry.register({
    name: "flow",
    description: "流水线测试",
    parameters: { type: "object" },
    executionMode: { kind: "exclusive" },
    execute() {
      order.push("body");
      return "body-result";
    },
  });
  registry.onPreExecute(async (_execution, next) => {
    order.push("pre:before");
    const decision = await next();
    order.push("pre:after");
    return decision;
  });
  registry.onExecute(async (_execution, next) => {
    order.push("execute:before");
    const result = await next();
    order.push("execute:after");
    return result;
  });
  registry.onPostExecute(async (_execution, result, next) => {
    order.push(`post:${result.output}`);
    await next();
    return { kind: "accept", output: "rewritten" };
  });

  await expect(registry.execute("flow", {}, new AbortController().signal, "c1"))
    .resolves.toEqual({ output: "rewritten", isError: false });
  expect(order).toEqual([
    "pre:before",
    "pre:after",
    "execute:before",
    "body",
    "execute:after",
    "post:body-result",
  ]);
});

test("preExecute 拒绝跳过主体，但拒绝结果仍经过 postExecute", async () => {
  const registry = new ToolRegistry();
  let bodyRan = false;
  let postSawError = false;
  registry.register({
    name: "danger",
    description: "危险操作",
    parameters: { type: "object" },
    executionMode: { kind: "exclusive" },
    execute() {
      bodyRan = true;
      return "unsafe";
    },
  });
  registry.onPreExecute(() => ({ kind: "deny", reason: "policy rejected call" }));
  registry.onPostExecute(async (_execution, result, next) => {
    postSawError = result.isError && result.error.code === "DENIED";
    return next();
  });

  const result = await registry.execute("danger", {}, new AbortController().signal);

  expect(bodyRan).toBe(false);
  expect(postSawError).toBe(true);
  expect(result).toMatchObject({ isError: true, error: { code: "DENIED" } });
});

test("executor 抛错规范化后进入 postExecute，post block 形成结构化失败", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "broken",
    description: "抛错工具",
    parameters: { type: "object" },
    executionMode: { kind: "parallel" },
    execute() {
      throw new Error("executor exploded");
    },
  });
  registry.onPostExecute(async (_execution, result, next) => {
    expect(result).toMatchObject({
      isError: true,
      error: { code: "TOOL_ERROR", message: "executor exploded" },
    });
    await next();
    return { kind: "block", feedback: "post policy blocked result" };
  });

  await expect(registry.execute("broken", {}, new AbortController().signal))
    .resolves.toEqual({
      output: "error: post policy blocked result",
      isError: true,
      error: { message: "post policy blocked result", code: "POST_BLOCKED" },
    });
});
