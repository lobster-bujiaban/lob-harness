import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Agent } from "./agent.ts";
import { LlmSettingsStore, type UpdateLlmSettings } from "./llm-settings.ts";
import { deriveWorkspaceRoot, projectMessages } from "./session.ts";
import { PluginStore } from "./plugins.ts";
import { JsonlSessionPersistence, type SessionPersistence } from "./session-persistence.ts";
import { forkSession } from "./session-store.ts";
import { CharacterTokenMeter, type ContextBudget } from "./context.ts";
import { SystemPromptRegistry, SystemPromptService, defaultCodingPrompt } from "./system-prompt.ts";
import { Context } from "@deepseek-ai/cordis";
import { settingsLlmProvider } from "./llm-service.ts";
import { assembleWebContext, dumpWebConfig, loadWebConfig, readProfilePatch, type ProductConfig } from "./composition.ts";
import { LocalFsProvider } from "./fs-service.ts";
import { PROMO_VIDEO_PROMPT } from "./promo-video-prompt.ts";

const DEFAULT_ROOTS = {
  tmp: resolve("tmp"),
  fixtures: resolve("test/fixtures"),
} as const;

export type SessionSource = keyof typeof DEFAULT_ROOTS;
export type SessionRoots = Record<SessionSource, string>;

type WebDependencies = {
  roots: SessionRoots;
  plugins: PluginStore;
  context: Context;
};

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "../web");
const PUBLIC_FILES: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/styles.css": "styles.css",
  "/app.js": "app.js",
  "/icons.svg": "icons.svg",
  "/lobster-logo.png": "lobster-logo.png",
};
const SERVER_STARTED_AT = Date.now();
const execFileAsync = promisify(execFile);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export function sessionFile(
  source: string,
  file: string,
  roots: SessionRoots = DEFAULT_ROOTS,
): string {
  if (source !== "tmp" && source !== "fixtures") {
    throw new Error("unknown source");
  }
  const safe = basename(file);
  if (safe !== file || !safe.endsWith(".jsonl")) {
    throw new Error("invalid file");
  }
  return join(roots[source], safe);
}

export async function listSessions(
  roots: SessionRoots = DEFAULT_ROOTS,
): Promise<
  { source: SessionSource; file: string; workspaceRoot: string; title: string; updatedAt: number }[]
> {
  const sessions: { source: SessionSource; file: string; workspaceRoot: string; title: string; updatedAt: number }[] = [];
  const providers = createPersistences(roots);
  for (const source of ["fixtures", "tmp"] as const) {
    for (const item of await providers[source].list()) {
      const events = await providers[source].load(item.id, { repair: false });
      const firstPrompt = events.find((event) => event.type === "user");
      sessions.push({
        source,
        file: item.id,
        workspaceRoot: deriveWorkspaceRoot(events),
        title: firstPrompt?.type === "user" ? firstPrompt.text : "新会话",
        updatedAt: item.updatedAt,
      });
    }
  }
  return sessions;
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function send(res: ServerResponse, status: number, body: string | Uint8Array, type: string) {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  send(res, status, JSON.stringify(data), "application/json; charset=utf-8");
}

function sendSse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > 16_384) {
      throw new Error("body too large");
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) return {};
  return JSON.parse(raw) as unknown;
}

async function payload(persistence: SessionPersistence, id: string, options?: { repair?: boolean }) {
  const events = await persistence.load(id, options);
  return {
    events,
    messages: projectMessages(events),
    workspaceRoot: deriveWorkspaceRoot(events),
  };
}

async function developmentVersion(): Promise<string> {
  const modified = await Promise.all(
    Object.values(PUBLIC_FILES).map(async (file) =>
      (await stat(join(PUBLIC_DIR, file))).mtimeMs
    ),
  );
  return `${SERVER_STARTED_AT}:${Math.max(...modified)}`;
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  dependencies: WebDependencies,
): Promise<void> {
  const { roots, plugins, context } = dependencies;
  const persistence: Record<SessionSource, SessionPersistence> = {
    tmp: context.sessions.get("tmp"),
    fixtures: context.sessions.get("fixtures"),
  };
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const method = req.method ?? "GET";

  if (method === "GET" && url.pathname === "/api/dev/version") {
    sendJson(res, 200, { version: await developmentVersion() });
    return;
  }

  if (url.pathname === "/api/settings/llm") {
    if (method === "GET") {
      sendJson(res, 200, await context.llm.describe());
      return;
    }
    if (method === "PUT") {
      try {
        const body = await readJsonBody(req);
        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          throw new Error("设置格式无效");
        }
        sendJson(
          res,
          200,
          await context.llm.update(body as UpdateLlmSettings),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "保存设置失败";
        sendJson(res, 400, { error: message });
      }
      return;
    }
    sendJson(res, 405, { error: "method not allowed" });
    return;
  }

  if (method === "POST" && url.pathname === "/api/settings/llm/models") {
    try {
      const body = await readJsonBody(req);
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("设置格式无效");
      sendJson(res, 200, { models: await context.llm.discoverModels(body) });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "获取模型目录失败" });
    }
    return;
  }

  if (url.pathname === "/api/plugins") {
    if (method === "GET") {
      sendJson(res, 200, { entries: await plugins.list() });
      return;
    }
    sendJson(res, 405, { error: "method not allowed" });
    return;
  }

  const pluginMatch = /^\/api\/plugins\/([^/]+)$/.exec(url.pathname);
  if (method === "PUT" && pluginMatch) {
    try {
      const id = decodeURIComponent(pluginMatch[1] ?? "");
      const body = await readJsonBody(req);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new Error("插件设置格式无效");
      }
      sendJson(res, 200, await plugins.update(id, body));
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "插件更新失败" });
    }
    return;
  }

  const pluginReloadMatch = /^\/api\/plugins\/([^/]+)\/reload$/.exec(url.pathname);
  if (method === "POST" && pluginReloadMatch) {
    try {
      const id = decodeURIComponent(pluginReloadMatch[1] ?? "");
      const body = await readJsonBody(req);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new Error("插件重载格式无效");
      }
      sendJson(res, 200, await plugins.reload(id, body));
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "插件重载失败" });
    }
    return;
  }

  if (method === "POST" && url.pathname === "/api/workspaces/pick") {
    if (process.platform !== "darwin") {
      sendJson(res, 501, { error: "native directory picker is only available on macOS" });
      return;
    }
    try {
      const { stdout } = await execFileAsync("/usr/bin/osascript", [
        "-e",
        'POSIX path of (choose folder with prompt "Select Workspace Directory")',
      ]);
      const workspaceRoot = await realpath(stdout.trim());
      if (!(await stat(workspaceRoot)).isDirectory()) throw new Error("workspace must be a directory");
      sendJson(res, 200, { workspaceRoot });
    } catch (error) {
      const message = error instanceof Error ? error.message : "directory picker failed";
      if (/User canceled|用户已取消|\(-128\)/i.test(message)) {
        sendJson(res, 200, { cancelled: true });
      } else {
        sendJson(res, 400, { error: message });
      }
    }
    return;
  }

  if (method === "POST" && url.pathname === "/api/sessions") {
    try {
      const body = await readJsonBody(req);
      const requested = typeof body === "object" && body !== null && "workspaceRoot" in body
        ? String((body as { workspaceRoot: unknown }).workspaceRoot).trim()
        : "";
      const workspaceRoot = requested.length === 0 ? process.cwd() : await realpath(requested);
      if (!(await stat(workspaceRoot)).isDirectory()) throw new Error("workspace must be a directory");
      const file = `chat-${Date.now()}.jsonl`;
      await persistence.tmp.create(file);
      await persistence.tmp.append(file, { type: "workspace_root", path: workspaceRoot });
      sendJson(res, 201, { source: "tmp", file, workspaceRoot });
    } catch (error) {
      const message = error instanceof Error ? error.message : "session create failed";
      sendJson(res, 400, { error: message });
    }
    return;
  }

  const collectionMatch = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
  if (method === "DELETE" && collectionMatch) {
    const source = decodeURIComponent(collectionMatch[1] ?? "");
    if (source !== "tmp") {
      sendJson(res, 403, { error: "fixtures are read-only" });
      return;
    }
    const workspaceRoot = url.searchParams.get("workspaceRoot");
    if (workspaceRoot !== null) {
      if (workspaceRoot.length === 0) {
        sendJson(res, 400, { error: "workspaceRoot is required" });
        return;
      }
      let deleted = 0;
      for (const item of await persistence.tmp.list()) {
        const events = await persistence.tmp.load(item.id, { repair: false });
        if (deriveWorkspaceRoot(events) !== workspaceRoot) continue;
        await context.agents.stop("tmp", item.id);
        await persistence.tmp.remove(item.id);
        deleted += 1;
      }
      sendJson(res, 200, { deleted });
      return;
    }
    const deleted = await persistence.tmp.clear();
    sendJson(res, 200, { deleted });
    return;
  }

  const turnMatch = /^\/api\/sessions\/([^/]+)\/([^/]+)\/turn$/.exec(url.pathname);
  if (method === "POST" && turnMatch) {
    const source = decodeURIComponent(turnMatch[1] ?? "");
    const file = decodeURIComponent(turnMatch[2] ?? "");
    if (source !== "tmp") {
      sendJson(res, 403, { error: "fixtures are read-only" });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "invalid json" });
      return;
    }
    const text =
      typeof body === "object" && body !== null && "text" in body
        ? String((body as { text: unknown }).text).trim()
        : "";
    if (text.length === 0) {
      sendJson(res, 400, { error: "text required" });
      return;
    }
    const wantsStream = req.headers.accept?.includes("text/event-stream") === true;
    let agent: Agent | undefined;
    const cancelDisconnected = () => {
      if (!res.writableEnded) agent?.cancel({ kind: "shutdown" });
    };
    try {
      const provider = persistence[source];
      sessionFile(source, file, roots);
      if (context.agents.get(source, file)?.status === "running") {
        sendJson(res, 409, { error: "session already running" });
        return;
      }
      const workspaceRoot = deriveWorkspaceRoot(await provider.load(file));
      if (wantsStream) {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });
      }
      await plugins.list();
      agent = context.agents.create({ source, id: file, workspaceRoot, onEvent: (event) => {
        if (!wantsStream) return;
        if (event.type === "status") {
          sendSse(res, "agent_status", { status: event.status });
        } else {
          sendSse(res, "session_event", event.event);
        }
      } });
      res.on("close", cancelDisconnected);
      await agent.followup(text);
      await agent.whenIdle();
      if (agent.error !== undefined) throw agent.error;
      const result = await payload(provider, file);
      if (wantsStream) {
        sendSse(res, "done", result);
        res.end();
      } else {
        sendJson(res, 200, result);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "turn failed";
      if (wantsStream && res.headersSent) {
        sendSse(res, "error", { error: message });
        res.end();
      } else {
        sendJson(res, 400, { error: message });
      }
    } finally {
      res.off("close", cancelDisconnected);
      if (agent !== undefined) context.agents.release(source, file, agent);
    }
    return;
  }

  const forkMatch = /^\/api\/sessions\/([^/]+)\/([^/]+)\/fork$/.exec(url.pathname);
  if (method === "POST" && forkMatch) {
    const source = decodeURIComponent(forkMatch[1] ?? "") as SessionSource;
    const file = decodeURIComponent(forkMatch[2] ?? "");
    try {
      sessionFile(source, file, roots);
      const body = await readJsonBody(req);
      const seq = typeof body === "object" && body !== null && "seq" in body
        ? Number((body as { seq: unknown }).seq)
        : Number.NaN;
      const targetFile = `chat-${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`;
      const events = await forkSession(persistence[source], file, persistence.tmp, targetFile, seq);
      sendJson(res, 201, {
        source: "tmp",
        file: targetFile,
        forkedFrom: { source, file, seq },
        workspaceRoot: deriveWorkspaceRoot(events),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "session fork failed";
      const status = isErrorCode(error, "ENOENT") ? 404 : 400;
      sendJson(res, status, { error: message });
    }
    return;
  }

  const workspaceMatch = /^\/api\/sessions\/([^/]+)\/([^/]+)\/workspace$/.exec(url.pathname);
  if (method === "PUT" && workspaceMatch) {
    const source = decodeURIComponent(workspaceMatch[1] ?? "");
    const file = decodeURIComponent(workspaceMatch[2] ?? "");
    if (source !== "tmp") {
      sendJson(res, 403, { error: "fixtures are read-only" });
      return;
    }
    try {
      sessionFile(source, file, roots);
      if (context.agents.get(source, file)?.status === "running") {
        sendJson(res, 409, { error: "cannot change workspace while agent is running" });
        return;
      }
      const body = await readJsonBody(req);
      const requested = typeof body === "object" && body !== null && "path" in body
        ? String((body as { path: unknown }).path).trim()
        : "";
      if (requested.length === 0) throw new Error("workspace path required");
      const canonical = await realpath(requested);
      if (!(await stat(canonical)).isDirectory()) throw new Error("workspace must be a directory");
      await persistence[source].append(file, { type: "workspace_root", path: canonical });
      sendJson(res, 200, { workspaceRoot: canonical });
    } catch (error) {
      const message = error instanceof Error ? error.message : "workspace update failed";
      sendJson(res, 400, { error: message });
    }
    return;
  }

  const stopMatch = /^\/api\/sessions\/([^/]+)\/([^/]+)\/stop$/.exec(url.pathname);
  if (method === "POST" && stopMatch) {
    const source = decodeURIComponent(stopMatch[1] ?? "");
    const file = decodeURIComponent(stopMatch[2] ?? "");
    if (source !== "tmp") {
      sendJson(res, 403, { error: "fixtures are read-only" });
      return;
    }
    try {
      sessionFile(source, file, roots);
      sendJson(res, 200, { cancelled: await context.agents.stop(source, file) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "stop failed";
      sendJson(res, 400, { error: message });
    }
    return;
  }

  const sessionMatch = /^\/api\/sessions\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (method === "DELETE" && sessionMatch) {
    const source = decodeURIComponent(sessionMatch[1] ?? "");
    const file = decodeURIComponent(sessionMatch[2] ?? "");
    if (source !== "tmp") {
      sendJson(res, 403, { error: "fixtures are read-only" });
      return;
    }
    try {
      sessionFile(source, file, roots);
      await persistence[source].remove(file);
      sendJson(res, 200, { deleted: 1 });
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) {
        sendJson(res, 404, { error: "session not found" });
        return;
      }
      const message = error instanceof Error ? error.message : "delete failed";
      sendJson(res, 400, { error: message });
    }
    return;
  }

  if (method !== "GET") {
    sendJson(res, 405, { error: "method not allowed" });
    return;
  }

  if (url.pathname === "/api/prompts/promo-video") {
    sendJson(res, 200, { text: PROMO_VIDEO_PROMPT });
    return;
  }

  if (url.pathname === "/api/sessions") {
    const sessions = await Promise.all((["fixtures", "tmp"] as const).map(async (source) => {
      const result = [];
      for (const item of await persistence[source].list()) {
        const events = await persistence[source].load(item.id, { repair: false });
        const firstPrompt = events.find((event) => event.type === "user");
        result.push({ source, file: item.id, workspaceRoot: deriveWorkspaceRoot(events), title: firstPrompt?.type === "user" ? firstPrompt.text : "新会话", updatedAt: item.updatedAt });
      }
      return result;
    }));
    sendJson(res, 200, sessions.flat());
    return;
  }

  if (sessionMatch) {
    const source = decodeURIComponent(sessionMatch[1] ?? "");
    const file = decodeURIComponent(sessionMatch[2] ?? "");
    try {
      sessionFile(source, file, roots);
      const provider = source === "tmp" ? persistence.tmp : persistence.fixtures;
      const running = context.agents.get(source, file)?.status === "running";
      sendJson(res, 200, await payload(provider, file, running ? { repair: false } : undefined));
    } catch (err) {
      const message = err instanceof Error ? err.message : "load failed";
      const status = message === "unknown source" || message === "invalid file" ? 400 : 404;
      sendJson(res, status, { error: message });
    }
    return;
  }

  const publicName = PUBLIC_FILES[url.pathname];
  if (publicName) {
    const path = join(PUBLIC_DIR, publicName);
    const content = await readFile(path);
    send(res, 200, content, MIME[extname(path)] ?? "application/octet-stream");
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

export function createWebServer(options?: {
  roots?: SessionRoots;
  llmSettings?: LlmSettingsStore;
  plugins?: PluginStore;
  persistence?: Partial<Record<SessionSource, SessionPersistence>>;
  systemPrompts?: SystemPromptRegistry;
  contextBudget?: ContextBudget;
  context?: Context;
  config?: ProductConfig;
}) {
  const roots = options?.roots ?? DEFAULT_ROOTS;
  const llmSettings =
    options?.llmSettings ?? new LlmSettingsStore(join(roots.tmp, "config"));
  const systemPrompts = options?.systemPrompts ?? new SystemPromptRegistry();
  if (options?.systemPrompts === undefined) {
    systemPrompts.register({ id: "coding", text: defaultCodingPrompt });
  }
  const contextBudget = options?.contextBudget ?? {
    // DeepSeek 128K 上下文窗口的 80% 压力线；Meter 使用约 4 chars/token 的启发式。
    maxInputTokens: Math.floor(131_072 * 0.8),
    meter: new CharacterTokenMeter(),
  };
  const configured = { ...createPersistences(roots), ...options?.persistence } as Record<SessionSource, SessionPersistence>;
  const config = options?.config ?? loadWebConfig();
  const context = assembleWebContext(config, {
    context: options?.context,
    sessionProviders: { jsonl: configured },
    llmProviders: { settings: settingsLlmProvider(llmSettings) },
    fsProviders: { local: new LocalFsProvider() },
    systemPrompt: systemPrompts,
    contextBudget,
  });
  const plugins = options?.plugins ?? new PluginStore(join(roots.tmp, "config"), context);
  return createServer((req, res) => {
    void handleRequest(req, res, { roots, plugins, context }).catch(() => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal error" });
      }
    });
  });
}

function createPersistences(roots: SessionRoots): Record<SessionSource, SessionPersistence> {
  return {
    tmp: new JsonlSessionPersistence(roots.tmp),
    fixtures: new JsonlSessionPersistence(roots.fixtures),
  };
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  const args = process.argv.slice(2);
  const profileIndex = args.indexOf("--profile");
  const profilePath = profileIndex < 0 ? undefined : args[profileIndex + 1];
  if (profileIndex >= 0 && profilePath === undefined) throw new Error("--profile 需要文件路径");
  const profile = profilePath === undefined ? undefined : await readProfilePatch(profilePath);
  const productConfig = loadWebConfig(profile);
  if (args.includes("--dump-config")) {
    process.stdout.write(dumpWebConfig(productConfig));
    process.exit(0);
  }
  const port = Number(process.env.PORT ?? 8787);
  const server = createWebServer({ config: productConfig });
  server.listen(port, "127.0.0.1", () => {
    console.log(`对话页 http://127.0.0.1:${port} · 模型可在 Web 设置中切换`);
  });
}
