import { IntegrationRuntimeError } from "./errors.js";

export type DeadlinePhase = "connect" | "response";

export interface DeadlineLimits {
  readonly connectMs: number;
  readonly responseMs: number;
  readonly totalMs: number;
}

export interface DeadlineBudget {
  readonly deadlineAt: number;
  readonly signal: AbortSignal;
  remainingMs(): number;
  runPhase<T>(phase: DeadlinePhase, operation: (signal: AbortSignal) => Promise<T>): Promise<T>;
  dispose(): void;
}

function positiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new IntegrationRuntimeError("invalid_input", { cause: new Error(`${field} must be a positive integer.`) });
  }
}

export async function runWithDeadline<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
): Promise<T> {
  positiveInteger(timeoutMs, "timeoutMs");
  const parentIsAborted = (): boolean => parentSignal?.aborted === true;
  if (parentIsAborted()) throw new IntegrationRuntimeError("cancelled");

  const controller = new AbortController();
  const timeoutState = { expired: false };
  const timeout = setTimeout(() => {
    timeoutState.expired = true;
    controller.abort();
  }, timeoutMs);
  const cancel = (): void => {
    controller.abort();
  };
  parentSignal?.addEventListener("abort", cancel, { once: true });

  try {
    const result = await operation(controller.signal);
    if (timeoutState.expired) throw new IntegrationRuntimeError("timeout", { retryable: true });
    if (parentIsAborted()) throw new IntegrationRuntimeError("cancelled");
    return result;
  } catch (error) {
    if (timeoutState.expired) throw new IntegrationRuntimeError("timeout", { cause: error, retryable: true });
    if (parentIsAborted()) throw new IntegrationRuntimeError("cancelled", { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", cancel);
  }
}

export function createDeadlineBudget(
  limits: DeadlineLimits,
  options: { readonly now?: () => number; readonly signal?: AbortSignal } = {},
): DeadlineBudget {
  positiveInteger(limits.connectMs, "connectMs");
  positiveInteger(limits.responseMs, "responseMs");
  positiveInteger(limits.totalMs, "totalMs");
  const now = options.now ?? Date.now;
  const startedAt = now();
  const deadlineAt = startedAt + limits.totalMs;
  const totalController = new AbortController();
  const totalTimeoutState = { expired: false };
  const totalTimeout = setTimeout(() => {
    totalTimeoutState.expired = true;
    totalController.abort();
  }, limits.totalMs);
  const cancel = (): void => {
    totalController.abort();
  };
  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener("abort", cancel, { once: true });

  return {
    deadlineAt,
    signal: totalController.signal,
    remainingMs: () => Math.max(0, deadlineAt - now()),
    async runPhase<T>(phase: DeadlinePhase, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
      const remaining = Math.max(0, deadlineAt - now());
      if (remaining === 0 || totalController.signal.aborted) {
        if (options.signal?.aborted) throw new IntegrationRuntimeError("cancelled");
        throw new IntegrationRuntimeError("timeout", { retryable: true });
      }
      const phaseLimit = phase === "connect" ? limits.connectMs : limits.responseMs;
      try {
        return await runWithDeadline(Math.min(phaseLimit, remaining), operation, totalController.signal);
      } catch (error) {
        if (totalTimeoutState.expired && !options.signal?.aborted) {
          throw new IntegrationRuntimeError("timeout", { cause: error, retryable: true });
        }
        throw error;
      }
    },
    dispose(): void {
      clearTimeout(totalTimeout);
      options.signal?.removeEventListener("abort", cancel);
    },
  };
}
