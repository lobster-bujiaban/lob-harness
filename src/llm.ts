import type { ModelMessage } from "./session.ts";
import { parseSse, SSE_DONE } from "./sse.ts";
import { HarnessError, normalizeFailure, throwIfAborted } from "./errors.ts";

export type ToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type LlmToolCall = { id: string; name: string; args: unknown };

export type LlmReply =
  | { kind: "text"; text: string }
  | { kind: "tool"; calls: LlmToolCall[] };

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  reasoningTokens?: number;
};

export type LlmStreamChunk =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | {
      type: "tool_call_delta";
      index: number;
      id?: string;
      name?: string;
      argumentsDelta: string;
    }
  | { type: "usage"; usage: TokenUsage }
  | { type: "finish"; reason: "stop" | "tool_calls" | "length" };

export interface LlmClient {
  complete(
    messages: ModelMessage[],
    tools: ToolSchema[],
    signal?: AbortSignal,
  ): Promise<LlmReply>;
  stream?(
    messages: ModelMessage[],
    tools: ToolSchema[],
    signal?: AbortSignal,
  ): AsyncIterable<LlmStreamChunk>;
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type OpenAiCompatOptions = {
  apiKey: string;
  baseURL?: string;
  model?: string;
  fetchImpl?: FetchLike;
  providerName?: string;
};

type WireToolCall = {
  id?: unknown;
  type?: unknown;
  function?: { name?: unknown; arguments?: unknown };
};

type WireResponse = {
  choices?: { message?: { content?: unknown; tool_calls?: unknown } }[];
  error?: { message?: unknown };
};

type WireStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: unknown;
      reasoning_content?: unknown;
      tool_calls?: Array<{
        index?: unknown;
        id?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      }>;
    };
    finish_reason?: unknown;
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    prompt_cache_hit_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown };
    completion_tokens_details?: { reasoning_tokens?: unknown };
  } | null;
};

const PUBLIC_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";

export class OpenAiCompatLlm implements LlmClient {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly model: string;
  private readonly fetchImpl: FetchLike;
  private readonly providerName: string;

  constructor(options: OpenAiCompatOptions) {
    const apiKey = options.apiKey.trim();
    if (apiKey.length === 0) {
      throw new Error("API Key is required for the OpenAI-compatible LLM");
    }
    if (/[\r\n]/u.test(apiKey)) {
      throw new Error("API Key contains invalid characters");
    }
    this.apiKey = apiKey;
    this.baseURL = (options.baseURL?.trim() || PUBLIC_BASE_URL).replace(/\/+$/u, "");
    this.model = options.model?.trim() || DEFAULT_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.providerName = options.providerName?.trim() || "OpenAI-compatible API";
  }

  async complete(
    messages: ModelMessage[],
    tools: ToolSchema[],
    signal?: AbortSignal,
  ): Promise<LlmReply> {
    throwIfAborted(signal);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          ...(tools.length > 0
            ? {
                tools: tools.map((tool) => ({
                  type: "function",
                  function: tool,
                })),
                tool_choice: "auto",
              }
            : {}),
        }),
        signal,
      });
    } catch (error) {
      const failure = normalizeFailure(error, signal);
      throw new HarnessError(
        failure.code === "ABORTED" ? `${this.providerName} request aborted` : `${this.providerName} request to ${this.baseURL} failed`,
        failure.code,
        { cause: error },
      );
    }

    const data = await readWireResponse(response);
    if (!response.ok) {
      const detail =
        typeof data.error?.message === "string"
          ? `: ${redact(data.error.message, this.apiKey)}`
          : "";
      throw new HarnessError(
        `${this.providerName} error (HTTP ${response.status})${detail}`,
        httpFailureCode(response.status, data.error?.message),
      );
    }

    const message = data.choices?.[0]?.message;
    if (message === undefined) {
      throw new HarnessError(`${this.providerName} returned no message`, "EMPTY_RESPONSE");
    }

    const calls = parseToolCalls(message.tool_calls);
    if (calls.length > 0) {
      return { kind: "tool", calls };
    }
    if (typeof message.content !== "string" || message.content.length === 0) {
      throw new HarnessError(`${this.providerName} returned an empty message`, "EMPTY_RESPONSE");
    }
    return { kind: "text", text: message.content };
  }

  async *stream(
    messages: ModelMessage[],
    tools: ToolSchema[],
    signal?: AbortSignal,
  ): AsyncIterable<LlmStreamChunk> {
    throwIfAborted(signal);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          accept: "text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: true,
          stream_options: { include_usage: true },
          ...(tools.length > 0
            ? {
                tools: tools.map((tool) => ({
                  type: "function",
                  function: tool,
                })),
                tool_choice: "auto",
              }
            : {}),
        }),
        signal,
      });
    } catch (error) {
      const failure = normalizeFailure(error, signal);
      throw new HarnessError(
        failure.code === "ABORTED" ? `${this.providerName} request aborted` : `${this.providerName} request to ${this.baseURL} failed`,
        failure.code,
        { cause: error },
      );
    }

    if (!response.ok) {
      const raw = await response.text();
      let detail = "";
      try {
        const data = JSON.parse(raw) as WireResponse;
        if (typeof data.error?.message === "string") {
          detail = `: ${redact(data.error.message, this.apiKey)}`;
        }
      } catch {
        // HTTP 状态仍是权威结果，非 JSON 错误体不影响分类。
      }
      throw new HarnessError(
        `${this.providerName} error (HTTP ${response.status})${detail}`,
        httpFailureCode(response.status, detail),
      );
    }
    if (response.body === null) {
      throw new HarnessError(`${this.providerName} returned no response body`, "EMPTY_RESPONSE");
    }

    let pendingUsage: TokenUsage | undefined;
    let pendingFinish: LlmStreamChunk & { type: "finish" } | undefined;
    let emittedContent = false;
    const toolArguments = new Map<number, { id?: string; name?: string; arguments: string }>();
    for await (const payload of parseSse(response.body, { allowEof: true })) {
      throwIfAborted(signal);
      if (payload === SSE_DONE) {
        if (pendingUsage !== undefined) yield { type: "usage", usage: pendingUsage };
        if (!emittedContent) {
          throw new HarnessError(`${this.providerName} returned an empty message`, "EMPTY_RESPONSE");
        }
        yield pendingFinish ?? { type: "finish", reason: "stop" };
        return;
      }
      let chunk: WireStreamChunk;
      try {
        chunk = JSON.parse(payload) as WireStreamChunk;
      } catch (error) {
        throw new Error(`${this.providerName} returned malformed SSE JSON`, { cause: error });
      }
      for (const choice of chunk.choices ?? []) {
        const reasoning = choice.delta?.reasoning_content;
        if (typeof reasoning === "string" && reasoning.length > 0) {
          emittedContent = true;
          yield { type: "reasoning_delta", text: reasoning };
        }
        const content = choice.delta?.content;
        if (typeof content === "string" && content.length > 0) {
          emittedContent = true;
          yield { type: "text_delta", text: content };
        }
        for (const call of choice.delta?.tool_calls ?? []) {
          if (typeof call.index !== "number" || !Number.isInteger(call.index)) {
            throw new Error(`${this.providerName} returned an invalid tool call index`);
          }
          const fragment = call.function?.arguments;
          if (fragment !== undefined && typeof fragment !== "string") {
            throw new Error(`${this.providerName} returned invalid tool arguments`);
          }
          emittedContent = true;
          const accumulated = toolArguments.get(call.index) ?? { arguments: "" };
          if (typeof call.id === "string") accumulated.id = call.id;
          if (typeof call.function?.name === "string") accumulated.name = call.function.name;
          accumulated.arguments += fragment ?? "";
          toolArguments.set(call.index, accumulated);
          yield {
            type: "tool_call_delta",
            index: call.index,
            ...(typeof call.id === "string" ? { id: call.id } : {}),
            ...(typeof call.function?.name === "string" ? { name: call.function.name } : {}),
            argumentsDelta: fragment ?? "",
          };
        }
        if (typeof choice.finish_reason === "string") {
          pendingFinish = {
            type: "finish",
            reason: mapStreamFinishReason(choice.finish_reason),
          };
        }
      }
      if (chunk.usage !== undefined && chunk.usage !== null) {
        pendingUsage = parseUsage(chunk.usage);
      }
    }
    const completeToolCalls = toolArguments.size > 0 && [...toolArguments.values()].every((call) => {
      if (!call.id || !call.name) return false;
      try {
        JSON.parse(call.arguments);
        return true;
      } catch {
        return false;
      }
    });
    if (pendingFinish === undefined && !completeToolCalls) {
      throw new Error("SSE stream ended without [DONE]");
    }
    if (pendingUsage !== undefined) yield { type: "usage", usage: pendingUsage };
    if (!emittedContent) {
      throw new HarnessError(`${this.providerName} returned an empty message`, "EMPTY_RESPONSE");
    }
    yield pendingFinish ?? { type: "finish", reason: "tool_calls" };
  }
}

function httpFailureCode(status: number, detail: unknown): import("./errors.ts").FailureCode {
  if (status === 429) return "RATE_LIMITED";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (
    status === 400
    && typeof detail === "string"
    && /context[\s_-]*(?:length|window).*(?:exceed|overflow|limit)/iu.test(detail)
  ) return "CONTEXT_WINDOW_EXCEEDED";
  return "UNKNOWN";
}

function mapStreamFinishReason(value: string): "stop" | "tool_calls" | "length" {
  if (value === "stop" || value === "tool_calls" || value === "length") return value;
  throw new Error(`DeepSeek API returned unsupported finish reason "${value}"`);
}

function parseUsage(value: NonNullable<WireStreamChunk["usage"]>): TokenUsage {
  const input = value.prompt_tokens;
  const output = value.completion_tokens;
  if (typeof input !== "number" || typeof output !== "number") {
    throw new Error("DeepSeek API returned invalid usage");
  }
  const cached = value.prompt_tokens_details?.cached_tokens ?? value.prompt_cache_hit_tokens;
  const reasoning = value.completion_tokens_details?.reasoning_tokens;
  return {
    inputTokens: input - (typeof cached === "number" ? cached : 0),
    outputTokens: output,
    ...(typeof cached === "number" ? { cacheReadTokens: cached } : {}),
    ...(typeof reasoning === "number" ? { reasoningTokens: reasoning } : {}),
  };
}

async function readWireResponse(response: Response): Promise<WireResponse> {
  try {
    return (await response.json()) as WireResponse;
  } catch (error) {
    throw new Error(`DeepSeek API returned invalid JSON (HTTP ${response.status})`, {
      cause: error,
    });
  }
}

function parseToolCalls(value: unknown): LlmToolCall[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error("DeepSeek API returned invalid tool_calls");
  }
  return value.map(parseToolCall);
}

function parseToolCall(value: unknown): LlmToolCall {
  if (typeof value !== "object" || value === null) {
    throw new Error("DeepSeek API returned an invalid tool call");
  }
  const raw = value as WireToolCall;
  const id = raw.id;
  const name = raw.function?.name;
  const args = raw.function?.arguments;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    (raw.type !== undefined && raw.type !== "function") ||
    typeof name !== "string" ||
    name.length === 0 ||
    typeof args !== "string"
  ) {
    throw new Error("DeepSeek API returned an invalid tool call");
  }
  try {
    return { id, name, args: JSON.parse(args) as unknown };
  } catch (error) {
    throw new Error(`DeepSeek API returned invalid arguments for tool "${name}"`, {
      cause: error,
    });
  }
}

function redact(message: string, secret: string): string {
  const safe = secret.length > 0 ? message.replaceAll(secret, "[redacted]") : message;
  return safe.slice(0, 500);
}

export class FakeLlm implements LlmClient {
  private index = 0;

  constructor(private readonly script: LlmReply[]) {}

  async complete(
    _messages: ModelMessage[],
    _tools: ToolSchema[],
    signal?: AbortSignal,
  ): Promise<LlmReply> {
    throwIfAborted(signal);
    const reply = this.script[this.index];
    if (reply === undefined) {
      throw new Error(`FakeLlm: no scripted reply for call ${this.index}`);
    }
    this.index += 1;
    return reply;
  }
}

export function scriptedEchoLlm(userText: string): FakeLlm {
  return new FakeLlm([
    {
      kind: "tool",
      calls: [{ id: crypto.randomUUID(), name: "echo", args: { text: userText } }],
    },
    { kind: "text", text: `已经 echo 了「${userText}」` },
  ]);
}
