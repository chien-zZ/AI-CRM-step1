import { IntegrationRuntimeError } from "./errors.js";

export type CircuitState = "closed" | "half_open" | "open";

export interface CircuitBreakerOptions {
  readonly failureThreshold: number;
  readonly halfOpenMaxCalls: number;
  readonly openMs: number;
  readonly now?: () => number;
}

export interface CircuitBreaker {
  execute<T>(operation: () => Promise<T>): Promise<T>;
  snapshot(): Readonly<{ failures: number; halfOpenActive: number; openedAt?: number; state: CircuitState }>;
}

export function createCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  if (
    !Number.isSafeInteger(options.failureThreshold) || options.failureThreshold < 1
    || !Number.isSafeInteger(options.halfOpenMaxCalls) || options.halfOpenMaxCalls < 1
    || !Number.isSafeInteger(options.openMs) || options.openMs < 1
  ) {
    throw new IntegrationRuntimeError("invalid_input");
  }
  const now = options.now ?? Date.now;
  let state: CircuitState = "closed";
  let failures = 0;
  let openedAt: number | undefined;
  let halfOpenActive = 0;

  const refresh = (): void => {
    if (state === "open" && openedAt !== undefined && now() >= openedAt + options.openMs) {
      state = "half_open";
      halfOpenActive = 0;
    }
  };

  const open = (): void => {
    state = "open";
    openedAt = now();
    halfOpenActive = 0;
  };

  return {
    async execute<T>(operation: () => Promise<T>): Promise<T> {
      refresh();
      if (state === "open" || (state === "half_open" && halfOpenActive >= options.halfOpenMaxCalls)) {
        throw new IntegrationRuntimeError("circuit_open", { retryable: true });
      }
      const probe = state === "half_open";
      if (probe) halfOpenActive += 1;
      try {
        const result = await operation();
        failures = 0;
        if (probe) {
          state = "closed";
          openedAt = undefined;
          halfOpenActive = 0;
        }
        return result;
      } catch (error) {
        failures += 1;
        if (probe || failures >= options.failureThreshold) open();
        throw error;
      } finally {
        if (probe && state === "half_open") halfOpenActive -= 1;
      }
    },
    snapshot(): Readonly<{ failures: number; halfOpenActive: number; openedAt?: number; state: CircuitState }> {
      refresh();
      return {
        failures,
        halfOpenActive,
        state,
        ...(openedAt === undefined ? {} : { openedAt }),
      };
    },
  };
}
