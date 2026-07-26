import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createBusinessConfigurationService,
  createMemoryBusinessConfigurationStore,
  type ConfigurationAudit,
  type ConfigurationAuthorizer,
  type ConfigurationCache,
  type ParameterDefinition,
} from "./index.js";

const actor = { actorId: "subject.synthetic", actorType: "authenticated_subject" as const };
const traceId = "1234567890abcdef1234567890abcdef";
const now = "2026-07-26T00:00:00.000Z";
const meta = () => ({ actor, operationId: randomUUID(), reason: "synthetic configuration test", traceId });
const authorization = (): ConfigurationAuthorizer & { authorize: ReturnType<typeof vi.fn> } => ({ authorize: vi.fn(() => Promise.resolve({ allowed: true, decisionId: randomUUID() })) });
const audit = (): ConfigurationAudit & { record: ReturnType<typeof vi.fn> } => ({ record: vi.fn(() => Promise.resolve()) });
const cache = (): ConfigurationCache & { get: ReturnType<typeof vi.fn>; invalidate: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } => ({ get: vi.fn(() => Promise.resolve(undefined)), invalidate: vi.fn(() => Promise.resolve()), set: vi.fn(() => Promise.resolve()) });
const service = (configurationCache: ConfigurationCache = cache(), authorizer: ConfigurationAuthorizer = authorization(), recorder: ConfigurationAudit = audit()) => createBusinessConfigurationService(createMemoryBusinessConfigurationStore(), authorizer, recorder, configurationCache, { clock: () => new Date(now), id: randomUUID });
const numberDefinition = (overrides: Partial<Omit<ParameterDefinition, "definitionVersion">> = {}): Omit<ParameterDefinition, "definitionVersion"> => ({
  allowedScopes: [{ priority: 100, scopeType: "context.primary" }, { priority: 10, scopeType: "context.secondary" }],
  defaultValue: 5,
  missingPolicy: "use_default",
  ownerModule: "platform.synthetic",
  parameterKey: "platform.synthetic.limit",
  valueSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", maximum: 100, minimum: 0, type: "integer" },
  valueType: "integer",
  ...overrides,
});
const failClosedDefinition = (): Omit<ParameterDefinition, "definitionVersion"> => {
  const definition = numberDefinition();
  return {
    allowedScopes: definition.allowedScopes,
    missingPolicy: "fail_closed",
    ownerModule: definition.ownerModule,
    parameterKey: definition.parameterKey,
    valueSchema: definition.valueSchema,
    valueType: definition.valueType,
  };
};

describe("business configuration service", () => {
  it("publishes immutable dictionary history and prevents stable code removal", async () => {
    const instance = service();
    const first = await instance.saveDictionaryDraft({ ...meta(), dictionaryId: "platform.synthetic.options", expectedRevision: 0, items: [{ code: "alpha", enabled: true, label: "Synthetic Alpha", order: 1 }], ownerModule: "platform.synthetic" });
    expect(first.draft.revision).toBe(1);
    await expect(instance.publishDictionary({ ...meta(), dictionaryId: "platform.synthetic.options", expectedRevision: 1 })).resolves.toMatchObject({ release: { releaseVersion: 1, version: 1 } });
    await instance.saveDictionaryDraft({ ...meta(), dictionaryId: "platform.synthetic.options", expectedRevision: 1, items: [{ code: "beta", enabled: true, label: "Synthetic Beta", order: 2 }], ownerModule: "platform.synthetic" });
    await expect(instance.publishDictionary({ ...meta(), dictionaryId: "platform.synthetic.options", expectedRevision: 2 })).rejects.toMatchObject({ code: "configuration_operation_conflict" });
    await expect(instance.getDictionaryRelease({ actor, dictionaryId: "platform.synthetic.options", releaseVersion: 1 })).resolves.toMatchObject({ items: [{ code: "alpha" }], releaseVersion: 1 });
  });

  it("validates typed values, rejects Secret-like strings and resolves an explicit default", async () => {
    const instance = service();
    await instance.registerParameter({ ...meta(), definition: numberDefinition() });
    await expect(instance.publishParameterValue({ ...meta(), parameterKey: "platform.synthetic.limit", value: 101 })).rejects.toMatchObject({ code: "configuration_invalid_input" });
    await expect(instance.resolveParameter({ actor, at: now, parameterKey: "platform.synthetic.limit", scopes: [] })).resolves.toEqual({ definitionVersion: 1, parameterKey: "platform.synthetic.limit", source: "default", value: 5, valueVersion: 0, version: 1 });

    await instance.registerParameter({ ...meta(), definition: { ...numberDefinition({ defaultValue: "safe", parameterKey: "platform.synthetic.label", valueSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", maxLength: 40, type: "string" }, valueType: "string" }) } });
    await expect(instance.publishParameterValue({ ...meta(), parameterKey: "platform.synthetic.label", value: "Bearer abc123" })).rejects.toMatchObject({ code: "configuration_invalid_input" });
  });

  it("uses the highest declared scope priority and rejects overlapping intervals", async () => {
    const instance = service();
    await instance.registerParameter({ ...meta(), definition: failClosedDefinition() });
    await instance.publishParameterValue({ ...meta(), parameterKey: "platform.synthetic.limit", value: 10 });
    await instance.publishParameterValue({ ...meta(), parameterKey: "platform.synthetic.limit", value: 20 });
    const primaryScope = { scopeReference: "synthetic:primary", scopeType: "context.primary" };
    const secondaryScope = { scopeReference: "synthetic:secondary", scopeType: "context.secondary" };
    await instance.activateParameter({ ...meta(), activationId: randomUUID(), effectiveFrom: "2026-07-01T00:00:00.000Z", parameterKey: "platform.synthetic.limit", scope: primaryScope, valueVersion: 2 });
    await instance.activateParameter({ ...meta(), activationId: randomUUID(), effectiveFrom: "2026-07-01T00:00:00.000Z", parameterKey: "platform.synthetic.limit", scope: secondaryScope, valueVersion: 1 });
    await expect(instance.resolveParameter({ actor, at: now, parameterKey: "platform.synthetic.limit", scopes: [secondaryScope, primaryScope] })).resolves.toMatchObject({ scope: primaryScope, source: "activation", value: 20, valueVersion: 2 });
    await expect(instance.activateParameter({ ...meta(), activationId: randomUUID(), effectiveFrom: "2026-07-15T00:00:00.000Z", parameterKey: "platform.synthetic.limit", scope: primaryScope, valueVersion: 1 })).rejects.toMatchObject({ code: "configuration_overlap" });
  });

  it("fails closed on missing values and replays only identical operation payloads", async () => {
    const instance = service();
    const command = { ...meta(), definition: failClosedDefinition() };
    await expect(instance.registerParameter(command)).resolves.toMatchObject({ replayed: false });
    await expect(instance.registerParameter(command)).resolves.toMatchObject({ replayed: true });
    await expect(instance.registerParameter({ ...command, definition: { ...command.definition, ownerModule: "platform.changed" } })).rejects.toMatchObject({ code: "configuration_operation_conflict" });
    await expect(instance.resolveParameter({ actor, at: now, parameterKey: "platform.synthetic.limit", scopes: [] })).rejects.toMatchObject({ code: "configuration_missing" });
  });

  it("authorizes before writes, records denials and maps dependency failures", async () => {
    const denied = authorization();
    denied.authorize.mockResolvedValue({ allowed: false, decisionId: randomUUID() });
    const recorder = audit();
    await expect(service(cache(), denied, recorder).registerParameter({ ...meta(), definition: numberDefinition() })).rejects.toMatchObject({ code: "configuration_denied" });
    expect(recorder.record).toHaveBeenCalledWith(expect.objectContaining({ result: "denied" }));
    await expect(service(cache(), { authorize: () => Promise.reject(new Error("down")) }, audit()).registerParameter({ ...meta(), definition: numberDefinition() })).rejects.toMatchObject({ code: "configuration_unavailable", retryable: true });
    await expect(service(cache(), authorization(), { record: () => Promise.reject(new Error("down")) }).registerParameter({ ...meta(), definition: numberDefinition() })).rejects.toMatchObject({ code: "configuration_unavailable", retryable: true });
  });

  it("falls back from cache failures and retries invalidation failures", async () => {
    const failingCache = cache();
    failingCache.get.mockRejectedValue(new Error("cache unavailable"));
    failingCache.set.mockRejectedValue(new Error("cache unavailable"));
    const instance = service(failingCache);
    await instance.registerParameter({ ...meta(), definition: numberDefinition() });
    await expect(instance.resolveParameter({ actor, at: now, parameterKey: "platform.synthetic.limit", scopes: [] })).resolves.toMatchObject({ source: "default", value: 5 });
    failingCache.get.mockResolvedValue({ parameterKey: "different.parameter", source: "default", value: 99, version: 1 });
    await expect(instance.resolveParameter({ actor, at: now, parameterKey: "platform.synthetic.limit", scopes: [] })).resolves.toMatchObject({ parameterKey: "platform.synthetic.limit", value: 5 });
    failingCache.get.mockResolvedValue({ activationId: randomUUID(), definitionVersion: 1, effectiveFrom: "2027-01-01T00:00:00.000Z", parameterKey: "platform.synthetic.limit", scope: { scopeReference: "not-requested", scopeType: "context.primary" }, source: "activation", value: 99, valueVersion: 99, version: 1 });
    await expect(instance.resolveParameter({ actor, at: now, parameterKey: "platform.synthetic.limit", scopes: [{ scopeReference: "requested", scopeType: "context.primary" }] })).resolves.toMatchObject({ source: "default", value: 5 });
    failingCache.get.mockResolvedValue({ activationId: randomUUID(), definitionVersion: 1, effectiveFrom: "2026-07-01T00:00:00.000Z", parameterKey: "platform.synthetic.limit", scope: { scopeReference: "requested", scopeType: "context.primary" }, source: "activation", value: 99, valueVersion: 99, version: 1 });
    await expect(instance.resolveParameter({ actor, at: now, parameterKey: "platform.synthetic.limit", scopes: [{ scopeReference: "requested", scopeType: "context.primary" }] })).resolves.toMatchObject({ source: "default", value: 5 });
    failingCache.invalidate.mockRejectedValueOnce(new Error("cache unavailable")).mockResolvedValueOnce(undefined);
    const event = { eventId: randomUUID(), eventType: "configuration.parameter.published" as const, occurredAt: now, resourceId: "platform.synthetic.limit", version: 1 };
    await expect(instance.handleInvalidation(event)).rejects.toMatchObject({ code: "configuration_unavailable", retryable: true });
    await expect(instance.handleInvalidation(event)).resolves.toBeUndefined();
  });
});
