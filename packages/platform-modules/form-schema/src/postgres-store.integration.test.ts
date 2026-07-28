import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createDatabaseRuntime, runMigrations, type DatabaseRuntime } from "@ai-crm/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createFormSchemaService, createPostgresFormSchemaCapabilityProbe, createPostgresFormSchemaQueryService, createPostgresFormSchemaStore } from "./index.js";

const urlFile = process.env.TEST_FORM_SCHEMA_DATABASE_URL_FILE;
const suite = describe.skipIf(!urlFile);
suite("PostgreSQL form schema", () => {
  let connectionString = "";
  let runtime: DatabaseRuntime | undefined;
  beforeAll(async () => {
    if (!urlFile) throw new Error("TEST_FORM_SCHEMA_DATABASE_URL_FILE is required.");
    connectionString = (await readFile(resolve(urlFile), "utf8")).trim();
    await runMigrations(connectionString, resolve(import.meta.dirname, "../../../database/migrations"));
    await runMigrations(connectionString, resolve(import.meta.dirname, "../migrations"));
    runtime = createDatabaseRuntime({ applicationName: "plt_02_form_test", connectionString, connectionTimeoutMs: 5_000, idleTimeoutMs: 5_000, maxConnections: 6, statementTimeoutMs: 5_000 });
  });
  afterAll(async () => runtime?.close());

  it("atomically publishes and reads an exact immutable release", async () => {
    if (!runtime) throw new Error("Form Schema runtime is unavailable.");
    const definitionId = `platform.synthetic.${randomUUID().replaceAll("-", "")}`;
    const instance = service(runtime);
    await instance.saveDraft({ ...meta(), definitionId, expectedRevision: 0, jsonSchema, ownerModule: "platform.synthetic", uiSchema });
    const published = await instance.publish({ ...meta(), definitionId, expectedRevision: 1 });
    await expect(instance.getRelease({ actor, definitionId, releaseVersion: published.reference.releaseVersion })).resolves.toMatchObject({ active: true, definitionId, releaseVersion: 1 });
    const evidence = await runtime.execute<{ outbox_count: number; receipt_count: number }>("select (select count(*)::int from form_schema.outbox_events where payload->>'definitionId'=$1) outbox_count,(select count(*)::int from form_schema.operation_receipts) receipt_count", [definitionId]);
    expect(evidence.rows[0]?.outbox_count).toBe(1);
    expect(evidence.rows[0]?.receipt_count).toBeGreaterThanOrEqual(2);
    await expect(runtime.execute("update form_schema.releases set content_digest=repeat('0',64) where definition_id=$1 and release_version=1", [definitionId])).rejects.toMatchObject({ code: "55000" });
    await expect(runtime.execute("delete from form_schema.releases where definition_id=$1 and release_version=1", [definitionId])).rejects.toMatchObject({ code: "55000" });
  });

  it("serializes duplicate operations and concurrent release version allocation", async () => {
    if (!runtime) throw new Error("Form Schema runtime is unavailable.");
    const definitionId = `platform.synthetic.${randomUUID().replaceAll("-", "")}`;
    const instance = service(runtime);
    const save = { ...meta(), definitionId, expectedRevision: 0, jsonSchema, ownerModule: "platform.synthetic", uiSchema };
    const drafts = await Promise.all([instance.saveDraft(save), instance.saveDraft(save)]);
    expect(drafts.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(drafts.every((result) => result.draft.definitionId === definitionId)).toBe(true);
    const releases = await Promise.all([instance.publish({ ...meta(), definitionId, expectedRevision: 1 }), instance.publish({ ...meta(), definitionId, expectedRevision: 1 })]);
    expect(releases.map((result) => result.reference.releaseVersion).sort()).toEqual([1, 2]);
  });

  it("keeps the probe aligned with exact-release queries under least-privilege column grants", async () => {
    if (!runtime) throw new Error("Form Schema runtime is unavailable.");
    const definitionId = `platform.probe.${randomUUID().replaceAll("-", "")}`;
    const instance = service(runtime);
    await instance.saveDraft({ ...meta(), definitionId, expectedRevision: 0, jsonSchema, ownerModule: "platform.synthetic", uiSchema });
    const published = await instance.publish({ ...meta(), definitionId, expectedRevision: 1 });
    await runtime.execute("alter table form_schema.releases add column capability_probe_extra text");
    const role = `form_probe_${randomUUID().replaceAll("-", "")}`;
    await runtime.execute(`create role "${role}" nologin`);
    await runtime.execute(`grant usage on schema form_schema to "${role}"`);
    await runtime.execute(`grant select (definition_id,release_version,owner_module,content_digest,json_schema,ui_schema,published_at) on form_schema.releases to "${role}"`);
    await runtime.execute(`grant select (definition_id,release_version,active) on form_schema.release_status to "${role}"`);
    const restricted = createDatabaseRuntime({ applicationName: "cmp_form_probe_test", connectionString, connectionTimeoutMs: 5_000, idleTimeoutMs: 5_000, maxConnections: 1, statementTimeoutMs: 5_000 });
    try {
      await restricted.execute(`set role "${role}"`);
      const probe = createPostgresFormSchemaCapabilityProbe(restricted);
      const query = createPostgresFormSchemaQueryService(restricted, {
        authorize: () => Promise.resolve({ allowed: true, decisionId: randomUUID() }),
      });
      const selectedAssignmentId = randomUUID();
      const context = {
        actor: { actorId: "subject:synthetic", actorType: "authenticated_subject" as const, assignmentId: selectedAssignmentId },
        subject: { activeAssignmentIds: [selectedAssignmentId], selectedAssignmentId, workforcePersonId: randomUUID() },
        traceId: "1234567890abcdef1234567890abcdef",
      };
      await expect(probe.check()).resolves.toEqual({ status: "available" });
      await expect(query.getRelease({ context, definitionId, releaseVersion: published.reference.releaseVersion })).resolves.toMatchObject({ definitionId });
      await runtime.execute(`revoke select (active) on form_schema.release_status from "${role}"`);
      await expect(probe.check()).resolves.toEqual({ status: "unavailable" });
      await expect(query.getRelease({ context, definitionId, releaseVersion: published.reference.releaseVersion })).rejects.toBeDefined();
    } finally {
      await restricted.close();
      await runtime.execute(`revoke select (definition_id,release_version,owner_module,content_digest,json_schema,ui_schema,published_at) on form_schema.releases from "${role}"`);
      await runtime.execute(`revoke select (definition_id,release_version,active) on form_schema.release_status from "${role}"`);
      await runtime.execute(`revoke usage on schema form_schema from "${role}"`);
      await runtime.execute(`drop role "${role}"`);
    }
  });
});

const actor = { actorId: "system.synthetic", actorType: "system" as const };
const meta = () => ({ actor, operationId: randomUUID(), reason: "synthetic integration", traceId: "1234567890abcdef1234567890abcdef" });
const jsonSchema = { $schema: "https://json-schema.org/draft/2020-12/schema", additionalProperties: false, properties: { synthetic_value: { maxLength: 20, minLength: 1, type: "string" } }, required: ["synthetic_value"], type: "object" };
const uiSchema = { fields: [{ component: "input" as const, field: "synthetic_value", order: 1 }], layout: "vertical" as const, version: 1 as const };
const service = (runtime: DatabaseRuntime) => createFormSchemaService(createPostgresFormSchemaStore(runtime), { authorize: vi.fn(() => Promise.resolve({ allowed: true, decisionId: randomUUID() })) }, { record: vi.fn(() => Promise.resolve()) }, { clock: () => new Date("2026-07-26T00:00:00.000Z"), id: randomUUID });
