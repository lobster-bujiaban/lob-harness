import type { FailureCode } from "./errors.ts";
import type { RequestError, RequestErrorAction } from "./loop.ts";

export type RetryPolicyConfig = {
  maxRetries?: number;
  retryableCodes?: readonly FailureCode[];
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
};

export type RetryClock = {
  sleep(delayMs: number, signal: AbortSignal): Promise<boolean>;
};

export type RetryInternals = {
  clock?: RetryClock;
  random?: () => number;
};

const DEFAULT_RETRYABLE_CODES: readonly FailureCode[] = [
  "EMPTY_RESPONSE",
  "RATE_LIMITED",
  "TIMEOUT",
];

/** 创建一个有次数上限、可取消、可确定性测试的指数退避策略。 */
export function createRetryPolicy(
  config: RetryPolicyConfig = {},
  internals: RetryInternals = {},
): RequestError {
  const policy = resolvePolicy(config);
  const clock = internals.clock ?? systemClock;
  const random = internals.random ?? Math.random;

  return async ({ attempt, failure, signal }): Promise<RequestErrorAction> => {
    if (!policy.retryableCodes.has(failure.code)) return undefined;
    // attempt=1 是首次请求；maxRetries 只计算其后的额外 provider 调用。
    if (attempt > policy.maxRetries) return undefined;
    const delayMs = localDelay(policy, attempt, random);
    if (!await clock.sleep(delayMs, signal)) return undefined;
    if (signal.aborted) return undefined;
    return { kind: "retry" };
  };
}

function resolvePolicy(config: RetryPolicyConfig) {
  const maxRetries = config.maxRetries ?? 5;
  const initialDelayMs = config.initialDelayMs ?? 500;
  const maxDelayMs = config.maxDelayMs ?? 10_000;
  const jitterRatio = config.jitterRatio ?? 0.1;
  const retryableCodes = config.retryableCodes ?? DEFAULT_RETRYABLE_CODES;

  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new Error("retry.maxRetries must be a non-negative safe integer");
  }
  if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0) {
    throw new Error("retry.initialDelayMs must be a positive finite number");
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0) {
    throw new Error("retry.maxDelayMs must be a positive finite number");
  }
  if (initialDelayMs > maxDelayMs) {
    throw new Error("retry.initialDelayMs must not exceed maxDelayMs");
  }
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) {
    throw new Error("retry.jitterRatio must be between 0 and 1");
  }
  if (retryableCodes.length === 0 || new Set(retryableCodes).size !== retryableCodes.length) {
    throw new Error("retry.retryableCodes must be non-empty and contain no duplicates");
  }

  return {
    maxRetries,
    initialDelayMs,
    maxDelayMs,
    jitterRatio,
    retryableCodes: new Set(retryableCodes),
  };
}

function localDelay(
  policy: ReturnType<typeof resolvePolicy>,
  retry: number,
  random: () => number,
): number {
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample > 1) {
    throw new Error("retry random sample must be between 0 and 1");
  }
  const exponent = Math.min(retry - 1, 1024);
  const exponential = Math.min(
    policy.initialDelayMs * 2 ** exponent,
    policy.maxDelayMs,
  );
  const jitter = 1 - policy.jitterRatio + 2 * policy.jitterRatio * sample;
  return Math.min(exponential * jitter, policy.maxDelayMs);
}

const systemClock: RetryClock = {
  sleep(delayMs, signal) {
    if (signal.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve(true);
      }, delayMs);
      function onAbort() {
        clearTimeout(timer);
        resolve(false);
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  },
};
