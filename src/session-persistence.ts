import { appendFile, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { SessionEvent } from "./session.ts";

export type PersistedSession = { id: string; updatedAt: number };

export interface SessionPersistence {
  create(id: string): Promise<void>;
  load(id: string): Promise<SessionEvent[]>;
  append(id: string, event: SessionEvent): Promise<void>;
  list(): Promise<PersistedSession[]>;
  remove(id: string): Promise<void>;
  clear(): Promise<number>;
}

export class JsonlSessionPersistence implements SessionPersistence {
  constructor(private readonly directory: string) {}

  async create(id: string): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.path(id), "", { flag: "wx" });
  }

  async load(id: string): Promise<SessionEvent[]> {
    const path = this.path(id);
    const text = await readFile(path, "utf8");
    const events = parseJsonl(text);
    const physicalLines = text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    if (events.length < physicalLines) {
      await writeFile(path, events.map((event) => JSON.stringify(event)).join("\n") + (events.length > 0 ? "\n" : ""), "utf8");
    }
    return events;
  }

  async append(id: string, event: SessionEvent): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await appendFile(this.path(id), `${JSON.stringify(event)}\n`, "utf8");
  }

  async list(): Promise<PersistedSession[]> {
    let names: string[];
    try { names = await readdir(this.directory); }
    catch (error) { if (isMissing(error)) return []; throw error; }
    return Promise.all(names.filter((name) => name.endsWith(".jsonl")).map(async (id) => ({
      id,
      updatedAt: (await stat(this.path(id))).mtimeMs,
    })));
  }

  async remove(id: string): Promise<void> { await unlink(this.path(id)); }

  async clear(): Promise<number> {
    const sessions = await this.list();
    await Promise.all(sessions.map(({ id }) => this.remove(id)));
    return sessions.length;
  }

  private path(id: string): string {
    if (basename(id) !== id || !id.endsWith(".jsonl")) throw new Error("invalid session id");
    return join(this.directory, id);
  }
}

export class MemorySessionPersistence implements SessionPersistence {
  private readonly sessions = new Map<string, { events: SessionEvent[]; updatedAt: number }>();
  private clock = 0;

  async create(id: string): Promise<void> {
    if (this.sessions.has(id)) throw fileExists();
    this.sessions.set(id, { events: [], updatedAt: ++this.clock });
  }

  async load(id: string): Promise<SessionEvent[]> {
    const session = this.sessions.get(id);
    if (session === undefined) throw notFound();
    return structuredClone(session.events);
  }

  async append(id: string, event: SessionEvent): Promise<void> {
    const session = this.sessions.get(id);
    if (session === undefined) throw notFound();
    session.events.push(structuredClone(event));
    session.updatedAt = ++this.clock;
  }

  async list(): Promise<PersistedSession[]> {
    return [...this.sessions].map(([id, value]) => ({ id, updatedAt: value.updatedAt }));
  }

  async remove(id: string): Promise<void> {
    if (!this.sessions.delete(id)) throw notFound();
  }

  async clear(): Promise<number> { const count = this.sessions.size; this.sessions.clear(); return count; }
}

export function persistenceForPath(path: string): { persistence: SessionPersistence; id: string } {
  return { persistence: new JsonlSessionPersistence(dirname(path)), id: basename(path) };
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

function notFound(): NodeJS.ErrnoException {
  return Object.assign(new Error("session not found"), { code: "ENOENT" });
}

function fileExists(): NodeJS.ErrnoException {
  return Object.assign(new Error("session already exists"), { code: "EEXIST" });
}

export function parseJsonl(text: string): SessionEvent[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  const hasTerminatedTail = lines.at(-1) === "";
  if (hasTerminatedTail) lines.pop();
  const events: SessionEvent[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line === undefined || line.length === 0) throw invalidJsonl(index + 1, "empty line");
    try { events.push(JSON.parse(line) as SessionEvent); }
    catch (error) {
      const isTruncatedTail = index === lines.length - 1 && !hasTerminatedTail;
      if (isTruncatedTail) break;
      throw invalidJsonl(index + 1, error instanceof Error ? error.message : "invalid JSON");
    }
  }
  return events;
}

function invalidJsonl(line: number, detail: string): Error & { code: string } {
  return Object.assign(new Error(`invalid session JSONL at line ${line}: ${detail}`), { code: "INVALID_SESSION_JSONL" });
}
