import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createBusinessConfigurationService, createMemoryBusinessConfigurationStore } from "./index.js";

const actor = { actorId: "subject.synthetic", actorType: "authenticated_subject" as const };
const metadata = () => ({ actor, operationId: randomUUID(), reason: "synthetic denied lookup", traceId: "1234567890abcdef1234567890abcdef" });

describe("configuration mutation authorization order", () => {
  it("denies before dictionary and parameter resource lookups", async () => {
    const store = createMemoryBusinessConfigurationStore();
    const findDictionaryDraft = vi.spyOn(store, "findDictionaryDraft");
    const findParameterDefinition = vi.spyOn(store, "findParameterDefinition");
    const authorize = vi.fn(() => Promise.resolve({ allowed: false, decisionId: randomUUID() }));
    const audit = { record: vi.fn(() => Promise.resolve()) };
    const cache = { get: vi.fn(() => Promise.resolve(undefined)), invalidate: vi.fn(() => Promise.resolve()), set: vi.fn(() => Promise.resolve()) };
    const service = createBusinessConfigurationService(store, { authorize }, audit, cache);

    await expect(service.saveDictionaryDraft({ ...metadata(), dictionaryId: "platform.synthetic.options", expectedRevision: 1, items: [], ownerModule: "platform.synthetic" })).rejects.toMatchObject({ code: "configuration_denied" });
    await expect(service.publishDictionary({ ...metadata(), dictionaryId: "platform.synthetic.options", expectedRevision: 1 })).rejects.toMatchObject({ code: "configuration_denied" });
    await expect(service.publishParameterValue({ ...metadata(), parameterKey: "platform.synthetic.limit", value: 1 })).rejects.toMatchObject({ code: "configuration_denied" });
    await expect(service.activateParameter({ ...metadata(), activationId: randomUUID(), effectiveFrom: "2026-07-01T00:00:00.000Z", parameterKey: "platform.synthetic.limit", scope: { scopeReference: "synthetic:1", scopeType: "context.synthetic" }, valueVersion: 1 })).rejects.toMatchObject({ code: "configuration_denied" });
    await expect(service.terminateParameterActivation({ ...metadata(), activationId: randomUUID(), effectiveTo: "2026-07-15T00:00:00.000Z", parameterKey: "platform.synthetic.limit", terminationId: randomUUID() })).rejects.toMatchObject({ code: "configuration_denied" });

    expect(findDictionaryDraft).not.toHaveBeenCalled();
    expect(findParameterDefinition).not.toHaveBeenCalled();
    expect(authorize).toHaveBeenCalledTimes(5);
    expect(audit.record).toHaveBeenCalledTimes(5);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ result: "denied" }));
  });
});
