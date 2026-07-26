import type { IntegrationErrorCategory } from "./errors.js";
import { IntegrationRuntimeError } from "./errors.js";

export interface RetryPolicy {
  readonly backoffMs: readonly number[];
  readonly jitterRatio: number;
  readonly maxAttempts: number;
  readonly retryableCategories: readonly IntegrationErrorCategory[];
}

export function validateRetryPolicy(policy: RetryPolicy): void {
  if (!Number.isSafeInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 10) {
    throw new IntegrationRuntimeError("invalid_input", { cause: new Error("maxAttempts must be at least one.") });
  }
  if (policy.backoffMs.length !== Math.max(0, policy.maxAttempts - 1)) {
    throw new IntegrationRuntimeError("invalid_input", { cause: new Error("backoffMs must define every retry delay.") });
  }
  if (policy.backoffMs.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 3_600_000)) {
    throw new IntegrationRuntimeError("invalid_input", { cause: new Error("backoffMs values must be non-negative integers.") });
  }
  if (!Number.isFinite(policy.jitterRatio) || policy.jitterRatio < 0 || policy.jitterRatio > 1) {
    throw new IntegrationRuntimeError("invalid_input", { cause: new Error("jitterRatio must be between zero and one.") });
  }
  const allowed = new Set<IntegrationErrorCategory>(["connection", "rate_limited", "timeout", "upstream_unavailable"]);
  if (new Set(policy.retryableCategories).size !== policy.retryableCategories.length
    || policy.retryableCategories.some((category) => !allowed.has(category))) {
    throw new IntegrationRuntimeError("invalid_input", { cause: new Error("retryableCategories contains an unsafe category.") });
  }
}

export function calculateBackoffMs(policy: RetryPolicy, attempt: number, random: () => number = Math.random): number {
  validateRetryPolicy(policy);
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt >= policy.maxAttempts) {
    throw new IntegrationRuntimeError("invalid_input", { cause: new Error("attempt does not identify a retry.") });
  }
  const base = policy.backoffMs[attempt - 1] ?? 0;
  const boundedRandom = Math.min(1, Math.max(0, random()));
  const factor = 1 - policy.jitterRatio + (2 * policy.jitterRatio * boundedRandom);
  return Math.min(3_600_000, Math.round(base * factor));
}

export function shouldRetry(policy: RetryPolicy, attempt: number, error: unknown): boolean {
  validateRetryPolicy(policy);
  return attempt < policy.maxAttempts
    && error instanceof IntegrationRuntimeError
    && error.retryable
    && policy.retryableCategories.includes(error.category);
}
