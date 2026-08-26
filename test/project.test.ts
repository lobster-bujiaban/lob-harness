import { expect, test } from "vitest";
import {
  projectMessages,
  type SessionEvent,
} from "../src/session.ts";
import { CharacterTokenMeter, fitContext } from "../src/context.ts";
import { SystemPromptRegistry } from "../src/system-prompt.ts";

const events: SessionEvent[] = [
  { type: "user", text: "用 echo 说 hi" },
  { type: "tool_call", id: "1", name: "echo", args: { text: "hi" } },
  { type: "tool_result", id: "1", name: "echo", output: "hi" },
  { type: "assistant", text: "已经 echo 了 hi" },
];

test("user / assistant 原文进入投影", () => {
  const messages = projectMessages(events);
  expect(messages[0]).toEqual({ role: "user", content: "用 echo 说 hi" });
  expect(messages[1]).toEqual({
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: "1",
        type: "function",
        function: { name: "echo", arguments: '{"text":"hi"}' },
      },
    ],
  });
  expect(messages[2]).toEqual({
    role: "tool",
    tool_call_id: "1",
    content: "hi",
  });
  expect(messages[3]).toEqual({ role: "assistant", content: "已经 echo 了 hi" });
});

test("同一次模型回复的连续工具调用投影成一条 assistant message", () => {
  expect(
    projectMessages([
      { type: "user", text: "echo 两次" },
      { type: "tool_call", id: "1", name: "echo", args: { text: "one" } },
      { type: "tool_call", id: "2", name: "echo", args: { text: "two" } },
      { type: "tool_result", id: "1", name: "echo", output: "one" },
      { type: "tool_result", id: "2", name: "echo", output: "two" },
    ]),
  ).toEqual([
    { role: "user", content: "echo 两次" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "1",
          type: "function",
          function: { name: "echo", arguments: '{"text":"one"}' },
        },
        {
          id: "2",
          type: "function",
          function: { name: "echo", arguments: '{"text":"two"}' },
        },
      ],
    },
    { role: "tool", tool_call_id: "1", content: "one" },
    { role: "tool", tool_call_id: "2", content: "two" },
  ]);
});

test("同一份 events 投影两次，结果深相等", () => {
  expect(projectMessages(events)).toEqual(projectMessages(events));
});

test("改投影函数、不改日志，模型看见的东西才会变", () => {
  const before = structuredClone(events);
  const full = projectMessages(events);
  const withoutTools = projectMessages(
    events.filter((event) => event.type === "user" || event.type === "assistant"),
  );

  expect(events).toEqual(before);
  expect(withoutTools).not.toEqual(full);
  expect(withoutTools).toEqual([
    { role: "user", content: "用 echo 说 hi" },
    { role: "assistant", content: "已经 echo 了 hi" },
  ]);
});

test("System Prompt section 按 order 和注册顺序动态组装并可撤销", () => {
  const registry = new SystemPromptRegistry();
  registry.register({ id: "later", text: "Later", order: 20 });
  const dispose = registry.register({ id: "first", text: "First", order: 10 });
  registry.register({ id: "same-order", text: "Same", order: 20 });
  expect(registry.messages()).toEqual([{ role: "system", content: "First\n\nLater\n\nSame" }]);
  dispose();
  expect(registry.render()).toBe("Later\n\nSame");
});

test("上下文超预算时先剪枝工具结果，再使用摘要，且无进展时失败", () => {
  const meter = new CharacterTokenMeter();
  const toolConversation = [
    { role: "assistant" as const, content: "", tool_calls: [{ id: "1", type: "function" as const, function: { name: "read", arguments: "{}" } }] },
    { role: "tool" as const, tool_call_id: "1", content: "x".repeat(10_000) },
  ];
  const pruned = fitContext(toolConversation, [], [], { maxInputTokens: 2000, meter });
  expect(pruned).toMatchObject({ strategy: "tool_result_prune" });
  expect(pruned?.messages[1]?.content).toContain("tool result middle pruned");
  expect(pruned?.messages[1]?.content.startsWith("x".repeat(4096))).toBe(true);
  expect(pruned?.messages[1]?.content.endsWith("x".repeat(1024))).toBe(true);

  const longHistory = Array.from({ length: 8 }, (_, index) => ({
    role: "user" as const,
    content: `${index}:${"y".repeat(300)}`,
  }));
  expect(fitContext(longHistory, [], [], { maxInputTokens: 350, meter, preserveRecent: 1 }))
    .toMatchObject({ strategy: "summary" });
  expect(() => fitContext([{ role: "user", content: "z".repeat(1000) }], [], [], {
    maxInputTokens: 100,
    meter,
  })).toThrow("no sufficient progress");
});

test("DeepSeek 128K 默认压力线不会误剪 160249 字符的首次工具结果", () => {
  const meter = new CharacterTokenMeter();
  const conversation = [{ role: "tool" as const, tool_call_id: "list", content: "x".repeat(160_249) }];
  expect(meter.count(conversation, [])).toBeLessThan(Math.floor(131_072 * 0.8));
  expect(fitContext(conversation, [], [], {
    maxInputTokens: Math.floor(131_072 * 0.8),
    meter,
  })).toBeUndefined();
});

test("context_compacted 事件替代旧模型 surface，但保留后续事件", () => {
  const compacted: SessionEvent[] = [
    { type: "user", text: "old" },
    {
      type: "context_compacted",
      throughSeq: 1,
      strategy: "summary",
      messages: [{ role: "system", content: "Conversation summary:\nold request" }],
      beforeTokens: 100,
      afterTokens: 20,
    },
    { type: "user", text: "new" },
  ];
  expect(projectMessages(compacted)).toEqual([
    { role: "system", content: "Conversation summary:\nold request" },
    { role: "user", content: "new" },
  ]);
});
