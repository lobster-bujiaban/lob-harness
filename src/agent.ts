import { randomUUID } from "node:crypto";
import type { LlmClient } from "./llm.ts";
import {
  type PreStepDecision,
  type PreStepPayload,
  type RequestErrorAction,
  type RequestErrorPayload,
} from "./loop.ts";
import { defaultAgentLoop, type AgentLoop } from "./agent-loop-service.ts";
import {
  deriveInbox,
  type InboxItem,
  type AgentCancelCause,
  type SessionEvent,
} from "./session.ts";
import { createRetryPolicy } from "./retry.ts";
import type { ToolRegistry } from "./tools.ts";
import { persistenceForPath, type SessionPersistence } from "./session-persistence.ts";
import { sessionStoreFor } from "./session-store.ts";
import type { ContextBudget } from "./context.ts";
import type { SystemPromptProvider } from "./system-prompt.ts";

export type AgentStatus = "idle" | "running";
export type AgentPreStep = (
  payload: PreStepPayload & { agent: Agent },
) => PreStepDecision | Promise<PreStepDecision>;
export type AgentRequestError = (
  payload: RequestErrorPayload & { agent: Agent },
) => RequestErrorAction | Promise<RequestErrorAction>;
export type AgentHooks = {
  agentLoop?: AgentLoop;
  preStep?: AgentPreStep;
  requestError?: AgentRequestError;
  toolRegistry?: ToolRegistry;
  persistence?: SessionPersistence;
  systemPrompts?: SystemPromptProvider;
  contextBudget?: ContextBudget;
};
export type AgentEvent =
  | { type: "status"; status: AgentStatus }
  | { type: "session_event"; event: SessionEvent };

export class Agent {
  private nextTurn: InboxItem[] = [];
  private nextStep: InboxItem[] = [];
  private currentStatus: AgentStatus = "idle";
  private currentError: unknown;
  private activity: Promise<void> = Promise.resolve();
  private initialized: Promise<void>;
  private activeTurn?: AbortController;
  private readonly requestError: AgentRequestError;
  private readonly persistence: SessionPersistence;
  private readonly sessionId: string;

  constructor(
    private readonly path: string,
    private readonly createLlm: (prompt: string) => LlmClient | Promise<LlmClient>,
    private readonly onEvent?: (event: AgentEvent) => void | Promise<void>,
    private readonly hooks: AgentHooks = {},
  ) {
    const target = hooks.persistence === undefined
      ? persistenceForPath(path)
      : { persistence: hooks.persistence, id: path };
    this.persistence = sessionStoreFor(target.persistence);
    this.sessionId = target.id;
    this.initialized = this.restore();
    this.requestError = hooks.requestError ?? createRetryPolicy();
  }

  get status(): AgentStatus {
    return this.currentStatus;
  }

  get error(): unknown {
    return this.currentError;
  }

  get inbox(): { readonly nextTurn: readonly InboxItem[]; readonly nextStep: readonly InboxItem[] } {
    return { nextTurn: this.nextTurn, nextStep: this.nextStep };
  }

  async followup(text: string): Promise<void> {
    await this.enqueue("next_turn", text);
    this.run();
  }

  async inject(text: string): Promise<void> {
    await this.enqueue("next_step", text);
  }

  /** 协作式取消当前 turn；已开始的模型或工具必须观察 signal 后收敛。 */
  cancel(cause: AgentCancelCause = { kind: "user" }): void {
    this.activeTurn?.abort(cause);
  }

  /** 唤醒队列驱动；重复调用只复用当前 driver。 */
  run(): void {
    if (this.currentStatus === "running") return;
    this.currentError = undefined;
    this.activeTurn = new AbortController();
    this.setStatus("running");
    this.activity = this.drive(this.activeTurn.signal).finally(() => {
      this.activeTurn = undefined;
      this.setStatus("idle");
    });
  }

  async whenIdle(): Promise<void> {
    let observed: Promise<void>;
    do {
      await (observed = this.activity);
    } while (observed !== this.activity);
  }

  private async restore(): Promise<void> {
    const events = await loadOrEmpty(this.persistence, this.sessionId);
    const inbox = deriveInbox(events);
    this.nextTurn = inbox.nextTurn;
    this.nextStep = inbox.nextStep;
  }

  private async enqueue(target: InboxItem["target"], text: string): Promise<void> {
    await this.initialized;
    const normalized = text.trim();
    if (normalized.length === 0) throw new Error("message text required");
    const item: InboxItem = { id: randomUUID(), target, text: normalized };
    const event: SessionEvent = { type: "inbox_inserted", ...item };
    await this.persistence.append(this.sessionId, event);
    (target === "next_turn" ? this.nextTurn : this.nextStep).push(item);
    await this.emit({ type: "session_event", event });
  }

  private async drive(signal: AbortSignal): Promise<void> {
    await this.initialized;
    try {
      while (this.nextTurn.length > 0) {
        const prompt = this.nextTurn[0];
        if (prompt === undefined) break;
        await (this.hooks.agentLoop ?? defaultAgentLoop).run(
          this.sessionId,
          await this.createLlm(prompt.text),
          prompt.text,
          {
            claimInitial: async (turn) => {
              const injected = await this.claimAllNextStep(turn);
              const claimedPrompt = await this.claimOneNextTurn(turn);
              return [
                ...injected.map((item) => item.text),
                ...(claimedPrompt === undefined ? [] : [claimedPrompt.text]),
              ];
            },
            claimNextStep: async (activeTurn) =>
              (await this.claimAllNextStep(activeTurn)).map((item) => item.text),
            preStep: this.hooks.preStep === undefined
              ? undefined
              : (payload) => this.hooks.preStep?.({ ...payload, agent: this })
                ?? { kind: "enter", messages: [...payload.messages] },
            requestError: (payload) => this.requestError({ ...payload, agent: this }),
            signal,
            toolRegistry: this.hooks.toolRegistry,
            persistence: this.persistence,
            systemPrompts: this.hooks.systemPrompts,
            contextBudget: this.hooks.contextBudget,
            onEvent: async (event) => this.emit({ type: "session_event", event }),
          },
        );
      }
    } catch (error) {
      // 单轮失败已经持久化；driver 收敛回 idle，后续 followup 可以继续唤醒。
      if (!signal.aborted) this.currentError = error;
    }
  }

  private async claimOneNextTurn(turn: number): Promise<InboxItem | undefined> {
    const item = this.nextTurn.shift();
    if (item !== undefined) await this.claim(item, turn);
    return item;
  }

  private async claimAllNextStep(turn: number): Promise<InboxItem[]> {
    const items = this.nextStep.splice(0);
    for (const item of items) await this.claim(item, turn);
    return items;
  }

  private async claim(item: InboxItem, turn: number): Promise<void> {
    const event: SessionEvent = { type: "inbox_claimed", ...item, turn };
    await this.persistence.append(this.sessionId, event);
    await this.emit({ type: "session_event", event });
  }

  private setStatus(status: AgentStatus): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    void this.emit({ type: "status", status });
  }

  private async emit(event: AgentEvent): Promise<void> {
    try {
      await this.onEvent?.(event);
    } catch {
      // 观察者不参与持久状态提交。
    }
  }
}

async function loadOrEmpty(persistence: SessionPersistence, id: string): Promise<SessionEvent[]> {
  try {
    return await persistence.load(id);
  } catch (error) {
    if (
      typeof error === "object" && error !== null && "code" in error
      && (error as { code?: unknown }).code === "ENOENT"
    ) return [];
    throw error;
  }
}
