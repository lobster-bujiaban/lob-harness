import { expect, test } from "vitest";
import { FakeLlm } from "../src/llm.ts";
import type { ModelMessage } from "../src/session.ts";

const messages: ModelMessage[] = [{ role: "user", content: "用 echo 说 hi" }];

test("按脚本返回写死的 reply", async () => {
  const llm = new FakeLlm([
    {
      kind: "tool",
      calls: [{ id: "1", name: "echo", args: { text: "hi" } }],
    },
    { kind: "text", text: "已完成" },
  ]);

  expect(await llm.complete(messages, [])).toEqual({
    kind: "tool",
    calls: [{ id: "1", name: "echo", args: { text: "hi" } }],
  });
  expect(await llm.complete(messages, [])).toEqual({
    kind: "text",
    text: "已完成",
  });
});
