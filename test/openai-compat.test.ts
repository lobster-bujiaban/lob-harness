import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { type FetchLike, OpenAiCompatLlm } from "../src/llm.ts";
import { runTurn } from "../src/loop.ts";
import { load } from "../src/session.ts";

type CapturedRequest = {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(chunks: unknown[]): Response {
  const body = [
    ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`),
    "data: [DONE]\n\n",
  ].join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

test("真实适配器按标准协议完成 echo 工具闭环", async () => {
  const responses = [
    sseResponse([
      {
        choices: [{
          delta: { reasoning_content: "需要调用工具" },
          finish_reason: null,
        }],
      },
      {
        choices: [{
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call-1",
                type: "function",
                function: { name: "echo", arguments: '{"text":' },
              },
            ],
          },
          finish_reason: null,
        }],
      },
      {
        choices: [{
          delta: { tool_calls: [{ index: 0, function: { arguments: '"hello"}' } }] },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 10, completion_tokens: 3 },
      },
    ]),
    sseResponse([
      { choices: [{ delta: { content: "echo " }, finish_reason: null }] },
      {
        choices: [{ delta: { content: "已完成" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 20, completion_tokens: 4 },
      },
    ]),
  ];
  const requests: CapturedRequest[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const response = responses.shift();
    if (response === undefined) throw new Error("unexpected request");
    return response;
  };
  const llm = new OpenAiCompatLlm({
    apiKey: "test-key",
    baseURL: "https://example.test/v1/",
    model: "deepseek-test",
    fetchImpl,
  });
  const dir = await mkdtemp(join(tmpdir(), "tiny-harness-"));
  const path = join(dir, "session.jsonl");

  await runTurn(path, llm, "调用 echo 说 hello");

  expect(requests).toHaveLength(2);
  expect(requests[0]?.url).toBe("https://example.test/v1/chat/completions");
  expect(requests[0]?.headers.get("authorization")).toBe("Bearer test-key");
  expect(requests[0]?.body).toMatchObject({
    model: "deepseek-test",
    stream: true,
    stream_options: { include_usage: true },
    tool_choice: "auto",
    messages: [{ role: "user", content: "调用 echo 说 hello" }],
    tools: [
      {
        type: "function",
        function: {
          name: "echo",
          parameters: {
            type: "object",
            required: ["text"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "read_file",
          parameters: {
            type: "object",
            required: ["path"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "list_files",
          parameters: { type: "object" },
        },
      },
      {
        type: "function",
        function: {
          name: "write_file",
          parameters: {
            type: "object",
            required: ["path", "content"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "grep",
          parameters: {
            type: "object",
            required: ["pattern"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "bash",
          parameters: {
            type: "object",
            required: ["command"],
          },
        },
      },
    ],
  });
  expect(requests[1]?.body.messages).toEqual([
    { role: "user", content: "调用 echo 说 hello" },
    {
      role: "assistant",
      content: "",
      reasoning_content: "需要调用工具",
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "echo", arguments: '{"text":"hello"}' },
        },
      ],
    },
    { role: "tool", tool_call_id: "call-1", content: "hello" },
  ]);
  expect(await load(path)).toEqual([
    { type: "turn_start", turn: 1 },
    { type: "step_start", turn: 1, step: 1 },
    { type: "user", text: "调用 echo 说 hello" },
    { type: "request_start", turn: 1, step: 1, attempt: 1 },
    { type: "assistant_chunk", kind: "reasoning", text: "需要调用工具" },
    {
      type: "assistant_chunk",
      kind: "tool_call",
      index: 0,
      id: "call-1",
      name: "echo",
      argumentsDelta: '{"text":',
    },
    {
      type: "assistant_chunk",
      kind: "tool_call",
      index: 0,
      argumentsDelta: '"hello"}',
    },
    { type: "usage", inputTokens: 10, outputTokens: 3 },
    {
      type: "request_end",
      turn: 1,
      step: 1,
      attempt: 1,
      reason: { kind: "completed" },
    },
    { type: "tool_call", id: "call-1", name: "echo", args: { text: "hello" } },
    { type: "tool_result", id: "call-1", name: "echo", output: "hello" },
    { type: "step_end", turn: 1, step: 1 },
    { type: "step_start", turn: 1, step: 2 },
    { type: "request_start", turn: 1, step: 2, attempt: 1 },
    { type: "assistant_chunk", kind: "text", text: "echo " },
    { type: "assistant_chunk", kind: "text", text: "已完成" },
    { type: "usage", inputTokens: 20, outputTokens: 4 },
    {
      type: "request_end",
      turn: 1,
      step: 2,
      attempt: 1,
      reason: { kind: "completed" },
    },
    { type: "assistant", text: "echo 已完成" },
    { type: "step_end", turn: 1, step: 2 },
    { type: "turn_end", turn: 1, reason: { kind: "completed" } },
  ]);
});

test("适配器错误不会泄露 API key", async () => {
  const fetchImpl: FetchLike = async () =>
    jsonResponse({ error: { message: "bad credential test-secret" } }, 401);
  const llm = new OpenAiCompatLlm({ apiKey: "test-secret", fetchImpl });

  await expect(
    llm.complete([{ role: "user", content: "hello" }], []),
  ).rejects.toThrow("bad credential [redacted]");
});

test("损坏的 tool arguments 会明确失败", async () => {
  const fetchImpl: FetchLike = async () =>
    jsonResponse({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "echo", arguments: "{" },
              },
            ],
          },
        },
      ],
    });
  const llm = new OpenAiCompatLlm({ apiKey: "test-key", fetchImpl });

  await expect(
    llm.complete([{ role: "user", content: "hello" }], []),
  ).rejects.toThrow('invalid arguments for tool "echo"');
});

test("真实流中途断开时保留 chunk，但不提交成功 assistant", async () => {
  const fetchImpl: FetchLike = async () => new Response(
    `data: ${JSON.stringify({
      choices: [{ delta: { content: "半段回复" }, finish_reason: null }],
    })}\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
  const llm = new OpenAiCompatLlm({ apiKey: "test-key", fetchImpl });
  const dir = await mkdtemp(join(tmpdir(), "tiny-harness-stream-cut-"));
  const path = join(dir, "session.jsonl");

  await expect(runTurn(path, llm, "hello")).rejects.toThrow("without [DONE]");
  expect(await load(path)).toEqual([
    { type: "turn_start", turn: 1 },
    { type: "step_start", turn: 1, step: 1 },
    { type: "user", text: "hello" },
    { type: "request_start", turn: 1, step: 1, attempt: 1 },
    { type: "assistant_chunk", kind: "text", text: "半段回复" },
    {
      type: "request_end",
      turn: 1,
      step: 1,
      attempt: 1,
      reason: {
        kind: "error",
        error: { message: "SSE stream ended without [DONE]", code: "UNKNOWN" },
      },
    },
    { type: "step_end", turn: 1, step: 1 },
    {
      type: "turn_end",
      turn: 1,
      reason: {
        kind: "error",
        error: { message: "SSE stream ended without [DONE]", code: "UNKNOWN" },
      },
    },
  ]);
});

test("适配器规范化限流、上下文溢出和空响应", async () => {
  const cases: Array<{ response: Response; code: string }> = [
    { response: jsonResponse({ error: { message: "slow down" } }, 429), code: "RATE_LIMITED" },
    {
      response: jsonResponse({ error: { message: "context length exceeded" } }, 400),
      code: "CONTEXT_WINDOW_EXCEEDED",
    },
    { response: jsonResponse({ choices: [] }), code: "EMPTY_RESPONSE" },
  ];

  for (const item of cases) {
    const llm = new OpenAiCompatLlm({
      apiKey: "test-key",
      fetchImpl: async () => item.response,
    });
    await expect(llm.complete([{ role: "user", content: "hello" }], []))
      .rejects.toMatchObject({ code: item.code });
  }
});
