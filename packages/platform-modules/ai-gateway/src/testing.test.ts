import { describe, expect, it } from "vitest";
import { createFakeModelAdapter } from "./testing.js";

describe("AI fake adapter", () => {
  it("plays deterministic synthetic results and faults", async () => {
    const adapter = createFakeModelAdapter({
      "platform.synthetic": [
        { category: "ai_adapter_unavailable", kind: "error", retryable: true },
        { kind: "result", result: { adapterVersion: "fake.v1", structuredOutput: { value: "synthetic" }, usage: { costMicros: 1, inputTokens: 1, outputTokens: 1 } } },
      ],
    });
    const input = { dataClassification: "synthetic" as const, modelPolicyVersion: "fake.v1", operationId: crypto.randomUUID(), structuredInput: { value: "fixture" }, useCaseId: "platform.synthetic" };
    await expect(adapter.invoke(input)).rejects.toMatchObject({ code: "ai_adapter_unavailable", retryable: true });
    await expect(adapter.invoke(input)).resolves.toMatchObject({ structuredOutput: { value: "synthetic" } });
    expect(adapter.calls()).toBe(2);
  });
});
