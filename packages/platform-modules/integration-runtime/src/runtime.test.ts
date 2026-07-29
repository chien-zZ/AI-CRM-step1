import { describe, expect, it, vi } from "vitest";
import { createCircuitBreaker } from "./circuit-breaker.js";
import { createDeadlineBudget, runWithDeadline } from "./deadline.js";
import { IntegrationRuntimeError } from "./errors.js";
import { createIntegrationExecutor, type IntegrationExecutionPolicy } from "./executor.js";
import { createConcurrencyLimiter, createFixedWindowRateLimiter } from "./limits.js";
import { calculateBackoffMs, shouldRetry, type RetryPolicy } from "./retry.js";

const retryPolicy: RetryPolicy = {
  backoffMs: [100, 200],
  jitterRatio: 0.2,
  maxAttempts: 3,
  retryableCategories: ["rate_limited", "timeout", "upstream_unavailable"],
};

const executionPolicy: IntegrationExecutionPolicy = {
  deadlines: { connectMs: 50, responseMs: 50, totalMs: 100 },
  operationId: "fixture.read",
  retry: retryPolicy,
  safety: "read",
};

describe("deadline primitives", () => {
  it("aborts a phase and classifies it as a retryable timeout", async () => {
    await expect(runWithDeadline(5, async (signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          resolve();
        }, { once: true });
      });
      throw new Error("adapter observed abort");
    })).rejects.toMatchObject({ category: "timeout", retryable: true });
  });

  it("returns at the deadline even when an adapter ignores cancellation", async () => {
    await expect(runWithDeadline(5, () => new Promise(() => undefined)))
      .rejects.toMatchObject({ category: "timeout", retryable: true });
  });

  it("caps connect and response phases by the remaining total budget", async () => {
    const budget = createDeadlineBudget({ connectMs: 100, responseMs: 100, totalMs: 5 });
    try {
      await expect(budget.runPhase("connect", async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            resolve();
          }, { once: true });
        });
        throw new Error("aborted");
      })).rejects.toMatchObject({ category: "timeout" });
    } finally {
      budget.dispose();
    }
  });

  it("inherits an already-aborted caller signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const budget = createDeadlineBudget(
      { connectMs: 100, responseMs: 100, totalMs: 100 },
      { signal: controller.signal },
    );
    try {
      await expect(budget.runPhase("connect", () => Promise.resolve("not-called")))
        .rejects.toMatchObject({ category: "cancelled" });
    } finally {
      budget.dispose();
    }
  });
});

describe("retry and limiting", () => {
  it("applies bounded symmetric jitter and an explicit retry allowlist", () => {
    expect(calculateBackoffMs(retryPolicy, 1, () => 0)).toBe(80);
    expect(calculateBackoffMs(retryPolicy, 1, () => 1)).toBe(120);
    expect(shouldRetry(retryPolicy, 1, new IntegrationRuntimeError("rate_limited", { retryable: true }))).toBe(true);
    expect(shouldRetry(retryPolicy, 1, new IntegrationRuntimeError("authentication", { retryable: true }))).toBe(false);
    expect(calculateBackoffMs({ ...retryPolicy, backoffMs: [3_600_000, 200], jitterRatio: 1 }, 1, () => 1)).toBe(3_600_000);
  });

  it("rejects excess concurrency without creating an unbounded queue", async () => {
    const limiter = createConcurrencyLimiter(1);
    let release!: () => void;
    const first = limiter.run(async () => new Promise<void>((resolve) => {
      release = resolve;
    }));
    await vi.waitFor(() => {
      expect(limiter.snapshot().active).toBe(1);
    });
    await expect(limiter.run(() => Promise.resolve(undefined))).rejects.toMatchObject({ category: "concurrency_limited" });
    release();
    await first;
  });

  it("reports a deterministic fixed-window retry delay", () => {
    let now = 1000;
    const limiter = createFixedWindowRateLimiter(1, 500, () => now);
    expect(limiter.check()).toEqual({ allowed: true, remaining: 0, retryAfterMs: 0 });
    expect(limiter.check()).toEqual({ allowed: false, remaining: 0, retryAfterMs: 500 });
    now = 1500;
    expect(limiter.check().allowed).toBe(true);
  });
});

describe("circuit breaker and executor", () => {
  it("opens after the configured failures and closes after a successful probe", async () => {
    let now = 0;
    const breaker = createCircuitBreaker({ failureThreshold: 2, halfOpenMaxCalls: 1, openMs: 100, now: () => now });
    await expect(breaker.execute(() => Promise.reject(new Error("first")))).rejects.toThrow("first");
    await expect(breaker.execute(() => Promise.reject(new Error("second")))).rejects.toThrow("second");
    await expect(breaker.execute(() => Promise.resolve("blocked"))).rejects.toMatchObject({ category: "circuit_open" });
    now = 100;
    await expect(breaker.execute(() => Promise.resolve("probe"))).resolves.toBe("probe");
    expect(breaker.snapshot().state).toBe("closed");
  });

  it("does not count caller-side or policy failures selected by the classifier", async () => {
    const breaker = createCircuitBreaker({
      countsAsFailure: (error) => error instanceof IntegrationRuntimeError && error.category === "upstream_unavailable",
      failureThreshold: 1,
      halfOpenMaxCalls: 1,
      openMs: 100,
    });
    await expect(breaker.execute(() => Promise.reject(new IntegrationRuntimeError("cancelled"))))
      .rejects.toMatchObject({ category: "cancelled" });
    expect(breaker.snapshot().state).toBe("closed");
  });

  it("does not count caller cancellation with the default circuit classifier", async () => {
    const breaker = createCircuitBreaker({ failureThreshold: 1, halfOpenMaxCalls: 1, openMs: 100 });
    await expect(breaker.execute(() => Promise.reject(new IntegrationRuntimeError("cancelled"))))
      .rejects.toMatchObject({ category: "cancelled" });
    expect(breaker.snapshot().state).toBe("closed");
  });

  it("retries only classified safe operations within the retry budget", async () => {
    let attempts = 0;
    const events: unknown[] = [];
    const executor = createIntegrationExecutor({
      circuitBreaker: createCircuitBreaker({ failureThreshold: 5, halfOpenMaxCalls: 1, openMs: 1000 }),
      concurrencyLimiter: createConcurrencyLimiter(1),
      observer: { record: (event) => {
        events.push(event);
      } },
      random: () => 0.5,
      rateLimiter: createFixedWindowRateLimiter(10, 1000),
      sleep: () => Promise.resolve(),
    });
    await expect(executor.execute(executionPolicy, () => {
      attempts += 1;
      if (attempts < 3) return Promise.reject(new IntegrationRuntimeError("upstream_unavailable", { retryable: true }));
      return Promise.resolve("accepted");
    })).resolves.toBe("accepted");
    expect(attempts).toBe(3);
    expect(events).toHaveLength(3);
  });

  it("rejects automatic retry for non-idempotent writes", async () => {
    const executor = createIntegrationExecutor({
      circuitBreaker: createCircuitBreaker({ failureThreshold: 2, halfOpenMaxCalls: 1, openMs: 1000 }),
      concurrencyLimiter: createConcurrencyLimiter(1),
      rateLimiter: createFixedWindowRateLimiter(10, 1000),
    });
    await expect(executor.execute({ ...executionPolicy, safety: "non_idempotent_write" }, () => Promise.resolve("unsafe")))
      .rejects.toMatchObject({ category: "invalid_input" });
    await expect(executor.execute({ ...executionPolicy, safety: "unknown" as "read" }, () => Promise.resolve("unsafe")))
      .rejects.toMatchObject({ category: "invalid_input" });
    await expect(executor.execute({ ...executionPolicy, deadlines: { ...executionPolicy.deadlines, totalMs: 3_600_001 } }, () => Promise.resolve("unsafe")))
      .rejects.toMatchObject({ category: "invalid_input" });
  });

  it("classifies expiry of the total operation budget as timeout", async () => {
    const executor = createIntegrationExecutor({
      circuitBreaker: createCircuitBreaker({ failureThreshold: 2, halfOpenMaxCalls: 1, openMs: 1000 }),
      concurrencyLimiter: createConcurrencyLimiter(1),
      rateLimiter: createFixedWindowRateLimiter(10, 1000),
    });
    const oneAttempt = { ...executionPolicy, deadlines: { connectMs: 50, responseMs: 50, totalMs: 5 }, retry: { ...retryPolicy, backoffMs: [], maxAttempts: 1 } };
    await expect(executor.execute(oneAttempt, async ({ signal }) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          resolve();
        }, { once: true });
      });
      throw new IntegrationRuntimeError("cancelled");
    })).rejects.toMatchObject({ category: "timeout" });
  });

  it("bounds an operation that never enters a phase and releases its concurrency slot", async () => {
    const limiter = createConcurrencyLimiter(1);
    const executor = createIntegrationExecutor({
      circuitBreaker: createCircuitBreaker({ failureThreshold: 2, halfOpenMaxCalls: 1, openMs: 1000 }),
      concurrencyLimiter: limiter,
      rateLimiter: createFixedWindowRateLimiter(10, 1000),
    });
    const oneAttempt = { ...executionPolicy, deadlines: { connectMs: 50, responseMs: 50, totalMs: 5 }, retry: { ...retryPolicy, backoffMs: [], maxAttempts: 1 } };
    await expect(executor.execute(oneAttempt, () => new Promise(() => undefined)))
      .rejects.toMatchObject({ category: "timeout" });
    expect(limiter.snapshot().active).toBe(0);
  });

  it("keeps one total deadline across retries and backoff", async () => {
    const sleep = vi.fn(async (_milliseconds: number, signal?: AbortSignal) => {
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve();
        else signal?.addEventListener("abort", () => {
          resolve();
        }, { once: true });
      });
      throw new IntegrationRuntimeError("cancelled");
    });
    const executor = createIntegrationExecutor({
      circuitBreaker: createCircuitBreaker({ failureThreshold: 5, halfOpenMaxCalls: 1, openMs: 1000 }),
      concurrencyLimiter: createConcurrencyLimiter(1),
      rateLimiter: createFixedWindowRateLimiter(10, 1000),
      sleep,
    });
    const policy = { ...executionPolicy, deadlines: { connectMs: 50, responseMs: 50, totalMs: 5 } };
    await expect(executor.execute(policy, () => Promise.reject(new IntegrationRuntimeError("upstream_unavailable", { retryable: true }))))
      .rejects.toMatchObject({ category: "timeout" });
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("does not let a failing observer alter operation success", async () => {
    const executor = createIntegrationExecutor({
      circuitBreaker: createCircuitBreaker({ failureThreshold: 2, halfOpenMaxCalls: 1, openMs: 1000 }),
      concurrencyLimiter: createConcurrencyLimiter(1),
      observer: { record: () => { throw new Error("telemetry unavailable"); } },
      rateLimiter: createFixedWindowRateLimiter(10, 1000),
    });
    const oneAttempt = { ...executionPolicy, retry: { ...retryPolicy, backoffMs: [], maxAttempts: 1 } };
    await expect(executor.execute(oneAttempt, () => Promise.resolve("accepted"))).resolves.toBe("accepted");
  });

  it("consumes an asynchronous observer rejection", async () => {
    const executor = createIntegrationExecutor({
      circuitBreaker: createCircuitBreaker({ failureThreshold: 2, halfOpenMaxCalls: 1, openMs: 1000 }),
      concurrencyLimiter: createConcurrencyLimiter(1),
      observer: { record: () => Promise.reject(new Error("telemetry unavailable")) },
      rateLimiter: createFixedWindowRateLimiter(10, 1000),
    });
    const oneAttempt = { ...executionPolicy, retry: { ...retryPolicy, backoffMs: [], maxAttempts: 1 } };
    await expect(executor.execute(oneAttempt, () => Promise.resolve("accepted"))).resolves.toBe("accepted");
    await new Promise<void>((resolve) => { queueMicrotask(resolve); });
  });
});
