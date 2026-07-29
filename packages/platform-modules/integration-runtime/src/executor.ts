import type { CircuitBreaker } from "./circuit-breaker.js";
import { createDeadlineBudget, runWithDeadline, type DeadlineLimits } from "./deadline.js";
import { IntegrationRuntimeError } from "./errors.js";
import type { ConcurrencyLimiter, RateLimiter } from "./limits.js";
import { calculateBackoffMs, shouldRetry, validateRetryPolicy, type RetryPolicy } from "./retry.js";

export type OperationSafety = "idempotent_write" | "non_idempotent_write" | "read";

export interface IntegrationExecutionPolicy {
  readonly deadlines: DeadlineLimits;
  readonly operationId: string;
  readonly retry: RetryPolicy;
  readonly safety: OperationSafety;
}

export interface IntegrationExecutionContext {
  readonly attempt: number;
  readonly deadlineAt: number;
  runConnect<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T>;
  runResponse<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T>;
  readonly signal: AbortSignal;
}

export interface IntegrationExecutionObserver {
  record(event: Readonly<{
    attempt: number;
    category?: string;
    durationMs: number;
    operationId: string;
    outcome: "failure" | "limited" | "success";
    retrying: boolean;
  }>): Promise<void> | void;
}

export interface IntegrationExecutor {
  execute<T>(
    policy: IntegrationExecutionPolicy,
    operation: (context: IntegrationExecutionContext) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>;
}

export function createIntegrationExecutor(options: {
  readonly circuitBreaker: CircuitBreaker;
  readonly concurrencyLimiter: ConcurrencyLimiter;
  readonly now?: () => number;
  readonly observer?: IntegrationExecutionObserver;
  readonly random?: () => number;
  readonly rateLimiter: RateLimiter;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}): IntegrationExecutor {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const record = (event: Parameters<IntegrationExecutionObserver["record"]>[0]): void => {
    try {
      const pending = options.observer?.record(event);
      if (pending !== undefined) void Promise.resolve(pending).catch(() => undefined);
    } catch {
      // Telemetry must never change the integration operation's result.
    }
  };
  const sleep = options.sleep ?? (async (milliseconds: number, signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) throw new IntegrationRuntimeError("cancelled");
    await new Promise<void>((resolve, reject) => {
      const complete = (): void => {
        signal?.removeEventListener("abort", cancel);
        resolve();
      };
      const timeout = setTimeout(complete, milliseconds);
      const cancel = (): void => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", cancel);
        reject(new IntegrationRuntimeError("cancelled"));
      };
      signal?.addEventListener("abort", cancel, { once: true });
    });
  });

  return {
    async execute<T>(
      policy: IntegrationExecutionPolicy,
      operation: (context: IntegrationExecutionContext) => Promise<T>,
      signal?: AbortSignal,
    ): Promise<T> {
      if (!/^[a-z][a-z0-9_.-]{2,79}$/.test(policy.operationId)
        || !(["idempotent_write", "non_idempotent_write", "read"] as const).includes(policy.safety)) {
        throw new IntegrationRuntimeError("invalid_input");
      }
      validateRetryPolicy(policy.retry);
      if (Object.values(policy.deadlines).some((value) => !Number.isSafeInteger(value) || value < 1)) {
        throw new IntegrationRuntimeError("invalid_input");
      }
      if (policy.safety === "non_idempotent_write" && policy.retry.maxAttempts !== 1) {
        throw new IntegrationRuntimeError("invalid_input", {
          cause: new Error("Non-idempotent writes must not be retried automatically."),
        });
      }

      const budget = createDeadlineBudget(policy.deadlines, { now, ...(signal === undefined ? {} : { signal }) });
      const classifyBudgetExpiry = (error: unknown): unknown => budget.signal.aborted && !signal?.aborted
        ? new IntegrationRuntimeError("timeout", { cause: error, retryable: true })
        : error;
      try {
        for (let attempt = 1; attempt <= policy.retry.maxAttempts; attempt += 1) {
          const startedAt = now();
          if (budget.signal.aborted) throw classifyBudgetExpiry(new IntegrationRuntimeError("cancelled"));
          const rate = options.rateLimiter.check();
          if (!rate.allowed) {
            const error = new IntegrationRuntimeError("rate_limited", { retryable: true });
            record({
              attempt,
              category: error.category,
              durationMs: Math.max(0, now() - startedAt),
              operationId: policy.operationId,
              outcome: "limited",
              retrying: false,
            });
            throw error;
          }

          try {
            const value = await options.concurrencyLimiter.run(
              async () => options.circuitBreaker.execute(async () => {
                try {
                  const remaining = budget.remainingMs();
                  if (remaining < 1) throw new IntegrationRuntimeError("timeout", { retryable: true });
                  const result = await runWithDeadline(remaining, () => operation({
                    attempt,
                    deadlineAt: budget.deadlineAt,
                    runConnect: (phase) => budget.runPhase("connect", phase),
                    runResponse: (phase) => budget.runPhase("response", phase),
                    signal: budget.signal,
                  }), budget.signal);
                  if (budget.signal.aborted && !signal?.aborted) {
                    throw new IntegrationRuntimeError("timeout", { retryable: true });
                  }
                  return result;
                } catch (error) {
                  throw classifyBudgetExpiry(error);
                }
              }),
              budget.signal,
            );
            record({
              attempt,
              durationMs: Math.max(0, now() - startedAt),
              operationId: policy.operationId,
              outcome: "success",
              retrying: false,
            });
            return value;
          } catch (caught) {
            const error = classifyBudgetExpiry(caught);
            const retrying = shouldRetry(policy.retry, attempt, error) && !budget.signal.aborted;
            record({
              attempt,
              ...(error instanceof IntegrationRuntimeError ? { category: error.category } : { category: "unclassified" }),
              durationMs: Math.max(0, now() - startedAt),
              operationId: policy.operationId,
              outcome: "failure",
              retrying,
            });
            if (!retrying) throw error;
            try {
              await sleep(calculateBackoffMs(policy.retry, attempt, random), budget.signal);
            } catch (error) {
              throw classifyBudgetExpiry(error);
            }
          }
        }
        throw new IntegrationRuntimeError("internal");
      } finally {
        budget.dispose();
      }
    },
  };
}
