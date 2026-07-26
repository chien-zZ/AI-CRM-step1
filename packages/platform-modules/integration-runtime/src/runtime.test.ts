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
});

describe("retry and limiting", () => {
  it("applies bounded symmetric jitter and an explicit retry allowlist", () => {
    expect(calculateBackoffMs(retryPolicy, 1, () => 0)).toBe(80);
    expect(calculateBackoffMs(retryPolicy, 1, () => 1)).toBe(120);
    expect(shouldRetry(retryPolicy, 1, new IntegrationRuntimeError("rate_limited", { retryable: true }))).toBe(true);
    expect(shouldRetry(retryPolicy, 1, new IntegrationRuntimeError("authentication", { retryable: true }))).toBe(false);
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
});
