import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseRuntime, runMigrations, type DatabaseRuntime } from "@ai-crm/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresAuditStore } from "./postgres-store.js";
import type { AuditRecord } from "./types.js";
import { fingerprint } from "./validation.js";

const urlFile = process.env.TEST_AUDIT_DATABASE_URL_FILE;
const suite = describe.skipIf(!urlFile);
suite("PostgreSQL audit store", () => {
  let runtime: DatabaseRuntime | undefined;
  beforeAll(async () => {
    if (!urlFile) throw new Error("TEST_AUDIT_DATABASE_URL_FILE is required.");
    const connectionString = (await readFile(resolve(urlFile), "utf8")).toString().trim();
    await runMigrations(connectionString, resolve(import.meta.dirname, "../../../database/migrations"));
    await runMigrations(connectionString, resolve(import.meta.dirname, "../migrations"));
    runtime = createDatabaseRuntime({ applicationName: "plt_01_audit_test", connectionString, connectionTimeoutMs: 5_000, idleTimeoutMs: 5_000, maxConnections: 4, statementTimeoutMs: 5_000 });
  });
  afterAll(async () => runtime?.close());

  it("persists and replays an append atomically", async () => {
    if (!runtime) throw new Error("Audit runtime is unavailable.");
    const store = createPostgresAuditStore(runtime);
    const record = auditRecord();
    await expect(store.append({ fingerprint: fingerprint(record), record })).resolves.toEqual({ auditId: record.auditId, replayed: false });
    await expect(store.append({ fingerprint: fingerprint(record), record: { ...record, auditId: randomUUID(), occurredAt: new Date().toISOString(), trace: { ...record.trace, traceId: "abcdef1234567890abcdef1234567890" } } })).resolves.toEqual({ auditId: record.auditId, replayed: true });
    await expect(store.findById(record.auditId)).resolves.toEqual(record);
  });

  it("rejects update and delete even through direct SQL", async () => {
    if (!runtime) throw new Error("Audit runtime is unavailable.");
    const record = auditRecord();
    await createPostgresAuditStore(runtime).append({ fingerprint: fingerprint(record), record });
    await expect(runtime.execute("update audit.records set reason_code = 'changed' where audit_id = $1", [record.auditId])).rejects.toMatchObject({ code: "55000" });
    await expect(runtime.execute("delete from audit.records where audit_id = $1", [record.auditId])).rejects.toMatchObject({ code: "55000" });
  });

  it("serializes concurrent duplicate operations", async () => {
    if (!runtime) throw new Error("Audit runtime is unavailable.");
    const record = auditRecord();
    const competingRecord = { ...record, auditId: randomUUID() };
    const store = createPostgresAuditStore(runtime);
    const results = await Promise.all([store.append({ fingerprint: fingerprint(record), record }), store.append({ fingerprint: fingerprint(record), record: competingRecord })]);
    expect(results.map(({ replayed }) => replayed).sort()).toEqual([false, true]);
    expect(new Set(results.map(({ auditId }) => auditId)).size).toBe(1);
    expect([record.auditId, competingRecord.auditId]).toContain(results[0].auditId);
  });
});

const auditRecord = (): AuditRecord => ({ action: "synthetic.changed", actor: { actorId: "system.synthetic", actorType: "system" }, auditId: randomUUID(), occurredAt: new Date().toISOString(), reason: { code: "synthetic_test" }, resource: { resourceId: "synthetic:1", resourceType: "synthetic_resource" }, result: "succeeded", trace: { operationId: randomUUID(), traceId: "1234567890abcdef1234567890abcdef" }, version: 1 });
