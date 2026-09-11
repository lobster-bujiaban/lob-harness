import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  FakeLlm,
  type LlmClient,
  type LlmReply,
  type ToolSchema,
} from "../src/llm.ts";
import { runTurn } from "../src/loop.ts";
import {
  load,
  projectMessages,
  type ModelMessage,
  type SessionEvent,
} from "../src/session.ts";

class RecordingLlm implements LlmClient {
  readonly snapshots: ModelMessage[][] = [];

  constructor(private readonly inner: LlmClient) {}

  async complete(
    messages: ModelMessage[],
    tools: ToolSchema[],
  ): Promise<LlmReply> {
    this.snapshots.push(structuredClone(messages));
    return this.inner.complete(messages, tools);
  }
}

function prefixesAtComplete(events: SessionEvent[]): SessionEvent[][] {
  const prefixes: SessionEvent[][] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.type === "user") {
      prefixes.push(events.slice(0, i + 1));
    }
    if (event.type === "tool_result" && events[i + 1]?.type !== "end") {
      prefixes.push(events.slice(0, i + 1));
    }
  }
  return prefixes;
}

test("每一次 complete 的 messages 都能从当时的日志前缀投影出来", async () => {
  const fixturePath = join(await mkdtemp(join(tmpdir(), "tiny-harness-replay-")), "replay.jsonl");

  const recorder = new RecordingLlm(
    new FakeLlm([
      { kind: "tool", calls: [{ id: "1", name: "echo", args: { text: "one" } }] },
      { kind: "tool", calls: [{ id: "2", name: "echo", args: { text: "two" } }] },
      { kind: "text", text: "两次 echo 都完成了" },
    ]),
  );

  await runTurn(fixturePath, recorder, "echo 两次");

  const events = await load(fixturePath);
  const prefixes = prefixesAtComplete(events);

  expect(recorder.snapshots).toHaveLength(prefixes.length);
  for (const [i, prefix] of prefixes.entries()) {
    expect(recorder.snapshots[i]).toEqual(projectMessages(prefix));
  }

  expect(projectMessages(events)).toEqual([
    ...(recorder.snapshots.at(-1) ?? []),
    { role: "assistant", content: "两次 echo 都完成了" },
  ]);
});
