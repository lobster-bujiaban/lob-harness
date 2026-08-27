import type { SessionPersistence, PersistedSession } from "./session-persistence.ts";
import type { SessionEvent } from "./session.ts";

export type SequencedSessionEvent = SessionEvent & { seq: number; at?: number };
export type SessionSubscription = (event: SequencedSessionEvent) => void | Promise<void>;

type CachedSession = {
  events: SequencedSessionEvent[];
  projections: Map<unknown, unknown>;
};

/** 内存会话服务：序号、缓存、订阅和 projection 生命周期位于持久化 Provider 之上。 */
export class SessionStore implements SessionPersistence {
  private readonly cache = new Map<string, CachedSession>();
  private readonly subscribers = new Map<string, Set<SessionSubscription>>();
  private readonly writes = new Map<string, Promise<void>>();

  constructor(private readonly persistence: SessionPersistence) {}

  async create(id: string): Promise<void> {
    await this.persistence.create(id);
    this.cache.set(id, { events: [], projections: new Map() });
  }

  async load(id: string): Promise<SequencedSessionEvent[]> {
    const session = await this.cached(id);
    return structuredClone(session.events);
  }

  async append(id: string, event: SessionEvent): Promise<void> {
    const previous = this.writes.get(id) ?? Promise.resolve();
    const current = previous.then(async () => {
      const session = await this.cached(id, true);
      const sequenced = {
        ...event,
        seq: session.events.length + 1,
        at: eventTime(event) ?? Date.now(),
      } as SequencedSessionEvent;
      await this.persistence.append(id, sequenced);
      session.events.push(structuredClone(sequenced));
      session.projections.clear();
      for (const subscriber of this.subscribers.get(id) ?? []) {
        try { await subscriber(structuredClone(sequenced)); }
        catch { /* 观察者不能回滚已经持久化的事件。 */ }
      }
    });
    this.writes.set(id, current);
    try { await current; }
    finally { if (this.writes.get(id) === current) this.writes.delete(id); }
  }

  async project<T>(id: string, key: unknown, build: (events: readonly SequencedSessionEvent[]) => T): Promise<T> {
    const session = await this.cached(id);
    if (!session.projections.has(key)) session.projections.set(key, build(session.events));
    return session.projections.get(key) as T;
  }

  subscribe(id: string, subscriber: SessionSubscription): () => void {
    const subscribers = this.subscribers.get(id) ?? new Set<SessionSubscription>();
    subscribers.add(subscriber);
    this.subscribers.set(id, subscribers);
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) this.subscribers.delete(id);
    };
  }

  async list(): Promise<PersistedSession[]> { return this.persistence.list(); }

  async remove(id: string): Promise<void> {
    await this.persistence.remove(id);
    this.cache.delete(id);
    this.subscribers.delete(id);
  }

  async clear(): Promise<number> {
    const count = await this.persistence.clear();
    this.cache.clear();
    this.subscribers.clear();
    return count;
  }

  private async cached(id: string, createIfMissing = false): Promise<CachedSession> {
    const existing = this.cache.get(id);
    if (existing !== undefined) return existing;
    let persisted: SessionEvent[];
    try { persisted = await this.persistence.load(id); }
    catch (error) {
      if (!createIfMissing || !isMissing(error)) throw error;
      await this.persistence.create(id);
      persisted = [];
    }
    const events = sequenceAndValidate(persisted);
    const session = { events, projections: new Map() };
    this.cache.set(id, session);
    return session;
  }
}

function eventTime(event: SessionEvent): number | undefined {
  if (!("at" in event)) return undefined;
  const at = (event as { at?: unknown }).at;
  return typeof at === "number" && Number.isFinite(at) ? at : undefined;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

const stores = new WeakMap<SessionPersistence, SessionStore>();

export function sessionStoreFor(persistence: SessionPersistence): SessionStore {
  if (persistence instanceof SessionStore) return persistence;
  const existing = stores.get(persistence);
  if (existing !== undefined) return existing;
  const store = new SessionStore(persistence);
  stores.set(persistence, store);
  return store;
}

export async function forkSession(
  source: SessionPersistence,
  sourceId: string,
  target: SessionPersistence,
  targetId: string,
  throughSeq: number,
): Promise<SequencedSessionEvent[]> {
  if (!Number.isInteger(throughSeq) || throughSeq < 0) throw invalidFork("seq must be a non-negative integer");
  const sourceEvents = await sessionStoreFor(source).load(sourceId);
  if (throughSeq > sourceEvents.length) throw invalidFork(`seq ${throughSeq} is outside session boundary ${sourceEvents.length}`);
  await sessionStoreFor(target).create(targetId);
  for (const event of sourceEvents.slice(0, throughSeq)) await sessionStoreFor(target).append(targetId, event);
  return sessionStoreFor(target).load(targetId);
}

export function sequenceAndValidate(events: SessionEvent[]): SequencedSessionEvent[] {
  let sawPersistedSequence = false;
  return events.map((event, index) => {
    const expected = index + 1;
    if (!("seq" in event)) {
      if (sawPersistedSequence) throw invalidSequence(`event ${expected} is missing seq`);
      return { ...event, seq: expected } as SequencedSessionEvent;
    }
    sawPersistedSequence = true;
    if (event.seq !== expected) throw invalidSequence(`expected seq ${expected}, received ${String(event.seq)}`);
    return event as SequencedSessionEvent;
  });
}

function invalidSequence(message: string): Error & { code: string } {
  return Object.assign(new Error(`invalid session sequence: ${message}`), { code: "INVALID_SESSION_SEQUENCE" });
}

function invalidFork(message: string): Error & { code: string } {
  return Object.assign(new Error(`invalid session fork: ${message}`), { code: "INVALID_SESSION_FORK" });
}
