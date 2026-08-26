import type { ToolRegistry } from "./tools.ts";
import { ToolError } from "./tools.ts";
import type { ToolsService } from "./tools-service.ts";
import { throwIfAborted } from "./errors.ts";

const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/u;
const RAW_NAME = /^[A-Za-z0-9_-]{1,64}$/u;

export type McpTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type McpCallResult = { content: string; isError?: boolean };

export interface McpSession {
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: unknown, signal: AbortSignal): Promise<McpCallResult>;
  close(): Promise<void>;
}

export type MemoryMcpHandler = (args: unknown, signal: AbortSignal) => Promise<McpCallResult> | McpCallResult;

export type MemoryMcpTool = McpTool & { handler: MemoryMcpHandler };

/** 进程内 MCP Provider：测试和教学 demo 用，不走真实 JSON-RPC。 */
export class MemoryMcpSession implements McpSession {
  private closed = false;

  constructor(private readonly definitions: readonly MemoryMcpTool[]) {}

  async listTools(): Promise<McpTool[]> {
    this.ensureOpen();
    return this.definitions.map(({ name, description, parameters }) => ({ name, description, parameters }));
  }

  async callTool(name: string, args: unknown, signal: AbortSignal): Promise<McpCallResult> {
    this.ensureOpen();
    throwIfAborted(signal);
    const tool = this.definitions.find((item) => item.name === name);
    if (tool === undefined) throw new ToolError(`mcp tool not found: ${name}`, "MCP_UNKNOWN_TOOL");
    return tool.handler(args, signal);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private ensureOpen(): void {
    if (this.closed) throw new ToolError("mcp session is closed", "MCP_DISCONNECTED");
  }
}

export function createDemoMcpSession(): McpSession {
  return new MemoryMcpSession([
    {
      name: "ping",
      description: "Demo MCP ping，返回 pong 和传入文本。",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "要回声的文本" } },
        required: ["text"],
        additionalProperties: false,
      },
      handler(args) {
        const text = typeof args === "object" && args !== null && "text" in args
          ? String((args as { text: unknown }).text)
          : "";
        return { content: `pong:${text}` };
      },
    },
  ]);
}

export function mcpPublicName(serverName: string, rawName: string): string {
  return `mcp__${serverName}__${rawName}`;
}

export function installMcpTools(
  registry: ToolRegistry,
  options: {
    serverName: string;
    session: McpSession;
    tools: readonly McpTool[];
    timeoutMs?: number;
  },
): () => void {
  const serverName = options.serverName.trim();
  if (!SERVER_NAME.test(serverName)) throw new Error("mcp serverName 无效");
  const timeoutMs = options.timeoutMs ?? 60_000;
  const seen = new Set<string>();
  const disposers = options.tools.map((tool) => {
    if (!RAW_NAME.test(tool.name)) throw new Error(`mcp tool name 无效: ${tool.name}`);
    if (seen.has(tool.name)) throw new Error(`duplicate mcp tool: ${tool.name}`);
    seen.add(tool.name);
    const publicName = mcpPublicName(serverName, tool.name);
    return registry.register({
      name: publicName,
      description: `[MCP:${serverName}] ${tool.description}`,
      parameters: structuredClone(tool.parameters),
      executionMode: { kind: "parallel" },
      timeoutMs,
      async execute(args, context) {
        const result = await options.session.callTool(tool.name, args, context.signal);
        if (result.isError === true) throw new ToolError(result.content, "MCP_TOOL_ERROR");
        return result.content;
      },
    });
  });
  return () => disposers.forEach((dispose) => dispose());
}

/** 发现远端工具并登记到 ctx.tools；失败时可选择不阻断本地工具。 */
export async function contributeMcpTools(
  tools: ToolsService,
  options: {
    serverName?: string;
    session: McpSession;
    failOnStartupError?: boolean;
    timeoutMs?: number;
    contributionId?: string;
  },
): Promise<() => void> {
  const serverName = (options.serverName ?? "demo").trim();
  if (!SERVER_NAME.test(serverName)) throw new Error("mcp serverName 无效");
  let listed: McpTool[];
  try {
    listed = await options.session.listTools();
  } catch (error) {
    await options.session.close().catch(() => undefined);
    if (options.failOnStartupError === true) throw error;
    return () => undefined;
  }
  const id = options.contributionId ?? `mcp:${serverName}`;
  const disposeContribution = tools.register(id, (registry) => installMcpTools(registry, {
    serverName,
    session: options.session,
    tools: listed,
    timeoutMs: options.timeoutMs,
  }));
  return () => {
    disposeContribution();
    void options.session.close();
  };
}
