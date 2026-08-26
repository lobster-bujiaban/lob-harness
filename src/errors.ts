export type FailureCode =
  | "ABORTED"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "CONTEXT_WINDOW_EXCEEDED"
  | "EMPTY_RESPONSE"
  | "UNKNOWN";

export type Failure = { message: string; code: FailureCode };

/** 带稳定错误码的 Harness 边界错误。 */
export class HarnessError extends Error {
  constructor(
    message: string,
    readonly code: FailureCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HarnessError";
  }
}

export function normalizeFailure(error: unknown, signal?: AbortSignal): Failure {
  if (error instanceof HarnessError) {
    return { message: safeMessage(error.message), code: error.code };
  }
  if (signal?.aborted) {
    const timeout = isTimeoutReason(signal.reason);
    return {
      message: timeout ? "operation timed out" : "operation aborted",
      code: timeout ? "TIMEOUT" : "ABORTED",
    };
  }
  if (isAbortReason(error)) return { message: "operation aborted", code: "ABORTED" };
  if (isTimeoutReason(error)) return { message: "operation timed out", code: "TIMEOUT" };
  return {
    message: safeMessage(error instanceof Error ? error.message : "unknown error"),
    code: "UNKNOWN",
  };
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const failure = normalizeFailure(signal.reason, signal);
    throw new HarnessError(failure.message, failure.code, {
      cause: signal.reason,
    });
  }
}

function isAbortReason(value: unknown): boolean {
  return value instanceof DOMException && value.name === "AbortError";
}

function isTimeoutReason(value: unknown): boolean {
  return value instanceof DOMException && value.name === "TimeoutError";
}

function safeMessage(message: string): string {
  return (message.length === 0 ? "unknown error" : message).slice(0, 500);
}
