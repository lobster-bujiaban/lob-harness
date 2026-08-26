import { Context, Service } from "@deepseek-ai/cordis";
import type { SessionPersistence } from "./session-persistence.ts";
import { SessionStore, sessionStoreFor } from "./session-store.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    sessions: SessionStoreService;
  }
}

/** Cordis 会话能力：Provider 选择留在装配层，消费者只依赖稳定的 ctx.sessions。 */
export class SessionStoreService extends Service {
  private readonly stores = new Map<string, SessionStore>();

  constructor(ctx: Context, providers: Record<string, SessionPersistence>) {
    super(ctx, "sessions");
    for (const [source, provider] of Object.entries(providers)) {
      this.stores.set(source, sessionStoreFor(provider));
    }
  }

  get(source: string): SessionStore {
    const store = this.stores.get(source);
    if (store === undefined) throw new Error(`unknown session source: ${source}`);
    return store;
  }

  sources(): string[] {
    return [...this.stores.keys()];
  }
}
