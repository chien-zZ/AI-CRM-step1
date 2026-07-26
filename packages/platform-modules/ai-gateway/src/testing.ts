import { AiGatewayError } from "./errors.js";
import type { AiModelAdapter, AiModelAdapterResult, JsonValue } from "./types.js";

export type FakeModelStep =
  | { readonly category: "ai_adapter_unavailable" | "ai_output_invalid"; readonly kind: "error"; readonly retryable?: boolean }
  | { readonly kind: "result"; readonly result: AiModelAdapterResult };

export function createFakeModelAdapter(fixtures: Readonly<Record<string, readonly FakeModelStep[]>>): AiModelAdapter & { readonly calls: () => number } {
  let calls = 0;
  const positions = new Map<string, number>();
  return {
    calls: () => calls,
    invoke(input) {
      const classification: unknown = input.dataClassification;
      if (classification !== "synthetic") return Promise.reject(new AiGatewayError("ai_data_policy_rejected"));
      const steps = fixtures[input.useCaseId];
      const position = positions.get(input.useCaseId) ?? 0;
      const step = steps?.[position];
      if (step === undefined) return Promise.reject(new AiGatewayError("ai_use_case_unavailable"));
      positions.set(input.useCaseId, position + 1);
      calls += 1;
      if (step.kind === "error") return Promise.reject(new AiGatewayError(step.category, { ...(step.retryable === undefined ? {} : { retryable: step.retryable }) }));
      return Promise.resolve(structuredClone(step.result));
    },
  };
}

export const syntheticJson = <T extends JsonValue>(value: T): T => structuredClone(value);
