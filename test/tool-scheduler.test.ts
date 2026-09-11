import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { FakeLlm } from "../src/llm.ts";
import { runTurn } from "../src/loop.ts";
import { load } from "../src/session.ts";
import { executeToolBatch, ToolRegistry } from "../src/tools.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("parallel 工具有限并发，乱序完成后仍按模型顺序返回和落日志", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "tiny-harness-parallel-")), "session.jsonl");
  const registry = new ToolRegistry();
  const releases = new Map<string, ReturnType<typeof deferred<string>>>();
  const started: string[] = [];
  registry.register({
    name: "controlled",
    description: "受控并发工具",
    parameters: { type: "object" },
    executionMode: { kind: "parallel" },
    async execute(args) {
      const id = String((args as { id: unknown }).id);
      started.push(id);
      const gate = deferred<string>();
      releases.set(id, gate);
      return gate.promise;
    },
  });
  const llm = new FakeLlm([
    {
      kind: "tool",
      calls: [
        { id: "c1", name: "controlled", args: { id: "first" } },
        { id: "c2", name: "controlled", args: { id: "second" } },
        { id: "c3", name: "controlled", args: { id: "third" } },
      ],
    },
    { kind: "text", text: "完成" },
  ]);

  const running = runTurn(path, llm, "并发", {
    toolRegistry: registry,
    maxToolConcurrency: 2,
  });
  await vi.waitFor(() => expect(started).toEqual(["first", "second"]));
  expect(releases.has("third")).toBe(false);
  releases.get("second")?.resolve("SECOND");
  await vi.waitFor(() => expect(started).toEqual(["first", "second", "third"]));
  releases.get("third")?.resolve("THIRD");
  releases.get("first")?.resolve("FIRST");
  await running;

  expect((await load(path)).filter((event) => event.type === "tool_result"))
    .toEqual([
      { type: "tool_result", id: "c1", name: "controlled", output: "FIRST" },
      { type: "tool_result", id: "c2", name: "controlled", output: "SECOND" },
      { type: "tool_result", id: "c3", name: "controlled", output: "THIRD" },
    ]);
});

test("exclusive 工具形成双向 barrier，前后 parallel 组不能跨越", async () => {
  const registry = new ToolRegistry();
  const started: string[] = [];
  const gates = new Map<string, ReturnType<typeof deferred<string>>>();
  const register = (name: string, kind: "parallel" | "exclusive") => registry.register({
    name,
    description: name,
    parameters: { type: "object" },
    executionMode: { kind },
    execute(args) {
      const id = String((args as { id: unknown }).id);
      started.push(id);
      const gate = deferred<string>();
      gates.set(id, gate);
      return gate.promise;
    },
  });
  register("parallel", "parallel");
  register("barrier", "exclusive");

  const running = executeToolBatch(registry, [
    { id: "1", name: "parallel", args: { id: "before-1" } },
    { id: "2", name: "parallel", args: { id: "before-2" } },
    { id: "3", name: "barrier", args: { id: "exclusive" } },
    { id: "4", name: "parallel", args: { id: "after" } },
  ], { signal: new AbortController().signal, maxConcurrency: 4 });

  await vi.waitFor(() => expect(started).toEqual(["before-1", "before-2"]));
  gates.get("before-2")?.resolve("before-2");
  await Promise.resolve();
  expect(started).not.toContain("exclusive");
  gates.get("before-1")?.resolve("before-1");
  await vi.waitFor(() => expect(started).toContain("exclusive"));
  expect(started).not.toContain("after");
  gates.get("exclusive")?.resolve("exclusive");
  await vi.waitFor(() => expect(started).toContain("after"));
  gates.get("after")?.resolve("after");
  await running;
});

test("工具超时协作取消并等待 executor 停稳后形成 TOOL_TIMEOUT", async () => {
  vi.useFakeTimers();
  try {
    const registry = new ToolRegistry();
    let settled = false;
    registry.register({
      name: "slow",
      description: "慢工具",
      parameters: { type: "object" },
      executionMode: { kind: "parallel" },
      timeoutMs: 100,
      execute(_args, { signal }) {
        return new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            settled = true;
            resolve("stopped");
          }, { once: true });
        });
      },
    });

    const pending = registry.execute("slow", {}, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(100);

    await expect(pending).resolves.toEqual({
      output: "error: tool timed out after 100ms",
      isError: true,
      error: { message: "tool timed out after 100ms", code: "TOOL_TIMEOUT" },
    });
    expect(settled).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test("调度上限和工具 timeoutMs 在配置边界校验", async () => {
  const registry = new ToolRegistry();
  expect(() => registry.register({
    name: "invalid-timeout",
    description: "invalid",
    parameters: {},
    executionMode: { kind: "exclusive" },
    timeoutMs: 0,
    execute: () => "never",
  })).toThrow("positive finite number");

  await expect(executeToolBatch(registry, [], {
    signal: new AbortController().signal,
    maxConcurrency: 0,
  })).rejects.toThrow("positive safe integer");
});
