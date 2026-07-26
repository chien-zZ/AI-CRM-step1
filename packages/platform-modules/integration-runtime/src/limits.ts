import { IntegrationRuntimeError } from "./errors.js";

export interface ConcurrencyLimiter {
  run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  snapshot(): Readonly<{ active: number; limit: number; queued: number }>;
}

interface WaitingOperation {
  readonly reject: (error: IntegrationRuntimeError) => void;
  readonly resolve: () => void;
  readonly signal?: AbortSignal;
}

export function createConcurrencyLimiter(limit: number, maxQueue = 0): ConcurrencyLimiter {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(maxQueue) || maxQueue < 0) {
    throw new IntegrationRuntimeError("invalid_input");
  }
  let active = 0;
  const queue: WaitingOperation[] = [];

  const release = (): void => {
    active -= 1;
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next || next.signal?.aborted) continue;
      active += 1;
      next.resolve();
      return;
    }
  };

  const acquire = async (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) throw new IntegrationRuntimeError("cancelled");
    if (active < limit) {
      active += 1;
      return;
    }
    if (queue.length >= maxQueue) throw new IntegrationRuntimeError("concurrency_limited", { retryable: true });
    await new Promise<void>((resolve, reject) => {
      const waiting: WaitingOperation = {
        resolve: () => {
          signal?.removeEventListener("abort", cancel);
          resolve();
        },
        reject,
        ...(signal === undefined ? {} : { signal }),
      };
      const cancel = (): void => {
        const index = queue.indexOf(waiting);
        if (index >= 0) queue.splice(index, 1);
        reject(new IntegrationRuntimeError("cancelled"));
      };
      signal?.addEventListener("abort", cancel, { once: true });
      queue.push(waiting);
    });
  };

  return {
    async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      await acquire(signal);
      try {
        if (signal?.aborted) throw new IntegrationRuntimeError("cancelled");
        return await operation();
      } finally {
        release();
      }
    },
    snapshot: () => ({ active, limit, queued: queue.length }),
  };
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterMs: number;
}

export interface RateLimiter {
  check(): RateLimitDecision;
}

export function createFixedWindowRateLimiter(limit: number, windowMs: number, now: () => number = Date.now): RateLimiter {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new IntegrationRuntimeError("invalid_input");
  }
  let windowStart = now();
  let used = 0;
  return {
    check(): RateLimitDecision {
      const current = now();
      if (current >= windowStart + windowMs) {
        windowStart = current;
        used = 0;
      }
      if (used >= limit) {
        return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, windowStart + windowMs - current) };
      }
      used += 1;
      return { allowed: true, remaining: limit - used, retryAfterMs: 0 };
    },
  };
}
