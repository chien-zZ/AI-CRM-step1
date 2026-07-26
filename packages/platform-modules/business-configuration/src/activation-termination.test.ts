import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createBusinessConfigurationService, createMemoryBusinessConfigurationStore, type ParameterDefinition } from "./index.js";

const actor = { actorId: "subject.synthetic", actorType: "authenticated_subject" as const };
const traceId = "1234567890abcdef1234567890abcdef";
const metadata = () => ({ actor, operationId: randomUUID(), reason: "synthetic activation timeline", traceId });
const definition: Omit<ParameterDefinition, "definitionVersion"> = { allowedScopes: [{ priority: 1, scopeType: "context.synthetic" }], missingPolicy: "fail_closed", ownerModule: "platform.synthetic", parameterKey: "platform.synthetic.timeline", valueSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", maximum: 100, minimum: 0, type: "integer" }, valueType: "integer" };

describe("immutable activation termination timeline", () => {
  it("terminates an open activation, preserves history and permits reactivation", async () => {
    const authorize = vi.fn(() => Promise.resolve({ allowed: true, decisionId: randomUUID() }));
    const audit = { record: vi.fn(() => Promise.resolve()) };
    const service = createBusinessConfigurationService(createMemoryBusinessConfigurationStore(), { authorize }, audit, { get: vi.fn(() => Promise.resolve(undefined)), invalidate: vi.fn(() => Promise.resolve()), set: vi.fn(() => Promise.resolve()) }, { clock: () => new Date("2026-07-26T00:00:00.000Z"), id: randomUUID });
    await service.registerParameter({ ...metadata(), definition });
    await service.publishParameterValue({ ...metadata(), parameterKey: definition.parameterKey, value: 10 });
    await service.publishParameterValue({ ...metadata(), parameterKey: definition.parameterKey, value: 20 });
    const scope = { scopeReference: "synthetic:timeline", scopeType: "context.synthetic" };
    const activationId = randomUUID();
    await service.activateParameter({ ...metadata(), activationId, effectiveFrom: "2026-07-01T00:00:00.000Z", parameterKey: definition.parameterKey, scope, valueVersion: 1 });
    const command = { ...metadata(), activationId, effectiveTo: "2026-07-26T00:00:00.000Z", parameterKey: definition.parameterKey, terminationId: randomUUID() };
    await expect(service.terminateParameterActivation(command)).resolves.toMatchObject({ replayed: false, termination: { activationId, effectiveTo: command.effectiveTo, version: 1 } });
    await expect(service.terminateParameterActivation(command)).resolves.toMatchObject({ replayed: true });
    await expect(service.terminateParameterActivation({ ...command, effectiveTo: "2026-07-27T00:00:00.000Z" })).rejects.toMatchObject({ code: "configuration_operation_conflict" });
    await expect(service.resolveParameter({ actor, at: "2026-07-10T00:00:00.000Z", parameterKey: definition.parameterKey, scopes: [scope] })).resolves.toMatchObject({ activationId, value: 10 });
    await expect(service.resolveParameter({ actor, at: "2026-07-20T00:00:00.000Z", parameterKey: definition.parameterKey, scopes: [scope] })).resolves.toMatchObject({ activationId, value: 10 });
    await expect(service.resolveParameter({ actor, at: "2026-07-27T00:00:00.000Z", parameterKey: definition.parameterKey, scopes: [scope] })).rejects.toMatchObject({ code: "configuration_missing" });
    const replacementId = randomUUID();
    await service.activateParameter({ ...metadata(), activationId: replacementId, effectiveFrom: command.effectiveTo, parameterKey: definition.parameterKey, scope, valueVersion: 2 });
    await expect(service.resolveParameter({ actor, at: "2026-07-27T00:00:00.000Z", parameterKey: definition.parameterKey, scopes: [scope] })).resolves.toMatchObject({ activationId: replacementId, value: 20 });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ action: "configuration:activate", ownerModule: "platform.synthetic" }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "configuration.parameter.activation.terminate", result: "succeeded" }));
  });
});
