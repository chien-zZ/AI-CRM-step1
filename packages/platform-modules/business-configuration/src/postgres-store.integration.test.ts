import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createDatabaseRuntime, runMigrations, type DatabaseRuntime } from "@ai-crm/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createBusinessConfigurationService, createPostgresBusinessConfigurationStore, type ParameterDefinition } from "./index.js";

const urlFile = process.env.TEST_BUSINESS_CONFIGURATION_DATABASE_URL_FILE;
const suite = describe.skipIf(!urlFile);
suite("PostgreSQL business configuration", () => {
  let runtime: DatabaseRuntime | undefined;
  beforeAll(async () => {
    if (!urlFile) throw new Error("TEST_BUSINESS_CONFIGURATION_DATABASE_URL_FILE is required.");
    const connectionString = (await readFile(resolve(urlFile), "utf8")).trim();
    await runMigrations(connectionString, resolve(import.meta.dirname, "../../../database/migrations"));
    await runMigrations(connectionString, resolve(import.meta.dirname, "../migrations"));
    runtime = createDatabaseRuntime({ applicationName: "plt_02_configuration_test", connectionString, connectionTimeoutMs: 5_000, idleTimeoutMs: 5_000, maxConnections: 6, statementTimeoutMs: 5_000 });
  });
  afterAll(async () => runtime?.close());

  it("atomically publishes and resolves versioned values with provenance", async () => {
    if (!runtime) throw new Error("Business Configuration runtime is unavailable.");
    const parameterKey = `platform.synthetic.${randomUUID().replaceAll("-", "")}`;
    const instance = service(runtime);
    await instance.registerParameter({ ...meta(), definition: definition(parameterKey) });
    const published = await instance.publishParameterValue({ ...meta(), parameterKey, value: 12 });
    const scope = { scopeReference: "synthetic:integration", scopeType: "context.synthetic" };
    const operation = meta();
    const activationId = randomUUID();
    await expect(instance.activateParameter({ ...operation, activationId, effectiveFrom: "2026-07-01T00:00:00.000Z", parameterKey, scope, valueVersion: published.release.valueVersion })).resolves.toEqual({ replayed: false });
    await expect(instance.activateParameter({ ...operation, activationId, effectiveFrom: "2026-07-01T00:00:00.000Z", parameterKey, scope, valueVersion: published.release.valueVersion })).resolves.toEqual({ replayed: true });
    await expect(instance.resolveParameter({ actor, at: "2026-07-26T00:00:00.000Z", parameterKey, scopes: [scope] })).resolves.toMatchObject({ activationId, parameterKey, source: "activation", value: 12, valueVersion: 1 });
    const evidence = await runtime.execute<{ outbox_count: number; receipt_count: number }>("select (select count(*)::int from business_configuration.outbox_events where resource_id=$1) outbox_count,(select count(*)::int from business_configuration.operation_receipts where operation_id=$2) receipt_count", [parameterKey, operation.operationId]);
    expect(evidence.rows[0]).toEqual({ outbox_count: 2, receipt_count: 1 });
  });

  it("serializes overlapping activations and duplicate operations", async () => {
    if (!runtime) throw new Error("Business Configuration runtime is unavailable.");
    const parameterKey = `platform.synthetic.${randomUUID().replaceAll("-", "")}`;
    const instance = service(runtime);
    const registration = { ...meta(), definition: definition(parameterKey) };
    const registrations = await Promise.all([instance.registerParameter(registration), instance.registerParameter(registration)]);
    expect(registrations.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(registrations.every((result) => result.definition.parameterKey === parameterKey)).toBe(true);
    await instance.publishParameterValue({ ...meta(), parameterKey, value: 1 });
    const scope = { scopeReference: "synthetic:concurrent", scopeType: "context.synthetic" };
    const outcomes = await Promise.allSettled([
      instance.activateParameter({ ...meta(), activationId: randomUUID(), effectiveFrom: "2026-07-01T00:00:00.000Z", parameterKey, scope, valueVersion: 1 }),
      instance.activateParameter({ ...meta(), activationId: randomUUID(), effectiveFrom: "2026-07-15T00:00:00.000Z", parameterKey, scope, valueVersion: 1 }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({ reason: { code: "configuration_overlap" } });
  });

  it("guards published values and activation facts from direct mutation", async () => {
    if (!runtime) throw new Error("Business Configuration runtime is unavailable.");
    const parameterKey = `platform.synthetic.${randomUUID().replaceAll("-", "")}`;
    const instance = service(runtime);
    await instance.registerParameter({ ...meta(), definition: definition(parameterKey) });
    await instance.publishParameterValue({ ...meta(), parameterKey, value: 3 });
    const activationId = randomUUID();
    await instance.activateParameter({ ...meta(), activationId, effectiveFrom: "2026-07-01T00:00:00.000Z", parameterKey, scope: { scopeReference: "synthetic:immutable", scopeType: "context.synthetic" }, valueVersion: 1 });
    await expect(runtime.execute("update business_configuration.parameter_values set value='4'::jsonb where parameter_key=$1 and value_version=1", [parameterKey])).rejects.toMatchObject({ code: "55000" });
    await expect(runtime.execute("delete from business_configuration.parameter_activations where activation_id=$1", [activationId])).rejects.toMatchObject({ code: "55000" });
  });

  it("terminates an activation immutably and serializes replacement races", async () => {
    if (!runtime) throw new Error("Business Configuration runtime is unavailable.");
    const parameterKey = `platform.synthetic.${randomUUID().replaceAll("-", "")}`;
    const instance = service(runtime);
    await instance.registerParameter({ ...meta(), definition: definition(parameterKey) });
    await instance.publishParameterValue({ ...meta(), parameterKey, value: 7 });
    const scope = { scopeReference: "synthetic:termination", scopeType: "context.synthetic" };
    const activationId = randomUUID();
    await instance.activateParameter({ ...meta(), activationId, effectiveFrom: "2026-07-01T00:00:00.000Z", parameterKey, scope, valueVersion: 1 });
    const termination = { ...meta(), activationId, effectiveTo: "2026-07-26T00:00:00.000Z", parameterKey, terminationId: randomUUID() };
    const terminations = await Promise.all([instance.terminateParameterActivation(termination), instance.terminateParameterActivation(termination)]);
    expect(terminations.map((result) => result.replayed).sort()).toEqual([false, true]);
    await expect(instance.resolveParameter({ actor, at: "2026-07-10T00:00:00.000Z", parameterKey, scopes: [scope] })).resolves.toMatchObject({ activationId, value: 7 });
    await expect(instance.resolveParameter({ actor, at: "2026-07-20T00:00:00.000Z", parameterKey, scopes: [scope] })).resolves.toMatchObject({ activationId, value: 7 });
    await expect(instance.resolveParameter({ actor, at: "2026-07-27T00:00:00.000Z", parameterKey, scopes: [scope] })).rejects.toMatchObject({ code: "configuration_missing" });
    const outcomes = await Promise.allSettled([
      instance.activateParameter({ ...meta(), activationId: randomUUID(), effectiveFrom: termination.effectiveTo, parameterKey, scope, valueVersion: 1 }),
      instance.activateParameter({ ...meta(), activationId: randomUUID(), effectiveFrom: termination.effectiveTo, parameterKey, scope, valueVersion: 1 }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({ reason: { code: "configuration_overlap" } });
    await expect(runtime.execute("update business_configuration.parameter_activation_terminations set effective_to='2026-07-16T00:00:00.000Z' where termination_id=$1", [termination.terminationId])).rejects.toMatchObject({ code: "55000" });
    await expect(runtime.execute("delete from business_configuration.parameter_activation_terminations where termination_id=$1", [termination.terminationId])).rejects.toMatchObject({ code: "55000" });
  });
});

const actor = { actorId: "system.synthetic", actorType: "system" as const };
const meta = () => ({ actor, operationId: randomUUID(), reason: "synthetic integration", traceId: "1234567890abcdef1234567890abcdef" });
const definition = (parameterKey: string): Omit<ParameterDefinition, "definitionVersion"> => ({ allowedScopes: [{ priority: 1, scopeType: "context.synthetic" }], missingPolicy: "fail_closed", ownerModule: "platform.synthetic", parameterKey, valueSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", maximum: 100, minimum: 0, type: "integer" }, valueType: "integer" });
const service = (runtime: DatabaseRuntime) => createBusinessConfigurationService(createPostgresBusinessConfigurationStore(runtime), { authorize: vi.fn(() => Promise.resolve({ allowed: true, decisionId: randomUUID() })) }, { record: vi.fn(() => Promise.resolve()) }, { get: vi.fn(() => Promise.resolve(undefined)), invalidate: vi.fn(() => Promise.resolve()), set: vi.fn(() => Promise.resolve()) }, { clock: () => new Date("2026-07-26T00:00:00.000Z"), id: randomUUID });
