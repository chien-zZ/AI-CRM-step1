import { IntegrationRuntimeError, type IntegrationErrorCategory } from "./errors.js";
import type { WebhookReplayStore } from "./webhook.js";

export type FaultStep<T> =
  | { readonly kind: "error"; readonly category: IntegrationErrorCategory; readonly retryable?: boolean }
  | { readonly kind: "result"; readonly value: T }
  | { readonly kind: "wait_for_abort" };

export function createScriptedOperation<T>(steps: readonly FaultStep<T>[]): {
  readonly calls: () => number;
  readonly invoke: (signal: AbortSignal) => Promise<T>;
} {
  let calls = 0;
  return {
    calls: () => calls,
    async invoke(signal: AbortSignal): Promise<T> {
      const step = steps[calls];
      calls += 1;
      if (!step) throw new IntegrationRuntimeError("internal");
      if (step.kind === "result") return step.value;
      if (step.kind === "error") {
        throw new IntegrationRuntimeError(step.category, { retryable: step.retryable ?? false });
      }
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => {
          resolve();
        }, { once: true });
      });
      throw new IntegrationRuntimeError("cancelled");
    },
  };
}

export function createInMemoryReplayStore(): WebhookReplayStore {
  const fingerprints = new Set<string>();
  let sequence = 0;
  return {
    reserve({ fingerprints: requested }) {
      if (requested.some((fingerprint) => fingerprints.has(fingerprint))) return Promise.resolve({ accepted: false });
      for (const fingerprint of requested) fingerprints.add(fingerprint);
      sequence += 1;
      return Promise.resolve({ accepted: true, reservationId: `fixture-${String(sequence)}` });
    },
  };
}
