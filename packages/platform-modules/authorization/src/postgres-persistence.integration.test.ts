import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseRuntime, runMigrations, type DatabaseRuntime } from "@ai-crm/database";
import { createPostgresAuthorizationPersistence } from "./postgres-persistence.js";
import { syntheticPolicySnapshot } from "./testing.js";
import type { AuthorizationDecisionRecord, AuthorizationPolicySnapshot } from "./types.js";

const urlFile = process.env.TEST_AUTHORIZATION_DATABASE_URL_FILE;
let runtime: DatabaseRuntime | undefined;
const integration = urlFile ? describe : describe.skip;

integration("PostgreSQL authorization policy persistence", () => {
  beforeAll(async () => {
    if (!urlFile) throw new Error("TEST_AUTHORIZATION_DATABASE_URL_FILE is required.");
    const connectionString = (await readFile(resolve(urlFile), "utf8")).trim();
    await runMigrations(connectionString, resolve(import.meta.dirname, "../../../database/migrations"));
    await runMigrations(connectionString, resolve(import.meta.dirname, "../migrations"));
    runtime = createDatabaseRuntime({ applicationName: "auth_persist_01_test", connectionString, connectionTimeoutMs: 5_000, idleTimeoutMs: 5_000, maxConnections: 6, statementTimeoutMs: 5_000 });
  });
  afterAll(async () => runtime?.close());

  it("migrates an empty schema without policy or decision seeds", async () => {
    const counts = await requiredRuntime().execute<{ decisions: string; policies: string; publications: string }>("select (select count(*) from authorization_core.policy_versions) policies,(select count(*) from authorization_core.policy_publications) publications,(select count(*) from authorization_core.decision_records) decisions");
    expect(counts.rows[0]).toEqual({ decisions: "0", policies: "0", publications: "0" });
  });

  it("publishes complete policies atomically, serializes concurrent changes, and replays safely", async () => {
    const persistence = createPostgresAuthorizationPersistence(requiredRuntime());
    const first = { contractVersion: "authorization-policy.v1", publicationId: randomUUID(), publishedAt: "2026-07-28T01:00:00.000Z", snapshot: syntheticPolicySnapshot() };
    const published = await persistence.publisher.publish(first);
    expect(await persistence.store.currentVersion()).toBe("synthetic-v1");
    expect((await persistence.store.load("synthetic-v1") as AuthorizationPolicySnapshot).version).toBe("synthetic-v1");
    await expect(persistence.publisher.publish(first)).resolves.toEqual({ ...published, replayed: true });

    const commands = ["synthetic-v2", "synthetic-v3"].map((version, index) => ({ ...first, publicationId: randomUUID(), publishedAt: `2026-07-28T01:00:0${String(index + 1)}.000Z`, snapshot: { ...syntheticPolicySnapshot(), version } }));
    const results = await Promise.all(commands.map((command) => persistence.publisher.publish(command)));
    expect(results.filter(({ previousVersion }) => previousVersion === "synthetic-v1")).toHaveLength(1);
    expect(results.some(({ previousVersion }) => previousVersion === "synthetic-v2" || previousVersion === "synthetic-v3")).toBe(true);
    const beforeRestore = await persistence.store.currentVersion(); expect(["synthetic-v2", "synthetic-v3"]).toContain(beforeRestore);
    const restoration = await persistence.publisher.publish({ ...first, publicationId: randomUUID(), publishedAt: "2026-07-28T01:00:03.000Z" });
    expect(restoration).toMatchObject({ previousVersion: beforeRestore, replayed: false, version: "synthetic-v1" });
    expect(await persistence.store.currentVersion()).toBe("synthetic-v1");
    const history = await requiredRuntime().execute<{ policy_version: string; previous_policy_version: string | null }>("select policy_version,previous_policy_version from authorization_core.policy_publications order by published_at");
    expect(history.rows.at(-1)).toEqual({ policy_version: "synthetic-v1", previous_policy_version: beforeRestore });
    expect(history.rows.filter(({ policy_version }) => policy_version === "synthetic-v1")).toHaveLength(2);
    expect((await requiredRuntime().execute("select * from authorization_core.current_policy")).rowCount).toBe(1);
  });

  it("enforces immutable facts and fails closed for a published empty/corrupt snapshot", async () => {
    const database = requiredRuntime();
    await expect(database.execute("update authorization_core.policy_versions set snapshot='{}'::jsonb where version='synthetic-v1'"))
      .rejects.toMatchObject({ code: "55000" });
    await expect(database.execute("delete from authorization_core.policy_publications"))
      .rejects.toMatchObject({ code: "55000" });
    await database.execute("insert into authorization_core.policy_versions(version,contract_version,content_digest,snapshot,created_at) values('empty-v1','authorization-policy.v1',$1,$2::jsonb,'2026-07-28T02:00:00.000Z')", ["0".repeat(64), JSON.stringify({ grants: [], permissions: [], roles: [], version: "empty-v1" })]);
    const publicationId = randomUUID();
    const result = { contentDigest: "0".repeat(64), publicationId, publishedAt: "2026-07-28T02:00:00.000Z", version: "empty-v1" };
    await database.execute("insert into authorization_core.policy_publications(publication_id,fingerprint,policy_version,content_digest,published_at,result) values($1,$2,'empty-v1',$2,'2026-07-28T02:00:00.000Z',$3::jsonb)", [publicationId, "0".repeat(64), JSON.stringify(result)]);
    await database.execute("update authorization_core.current_policy set version='empty-v1',content_digest=$1,publication_id=$2,updated_at='2026-07-28T02:00:00.000Z' where singleton=true", ["0".repeat(64), publicationId]);
    await expect(createPostgresAuthorizationPersistence(database).store.load("empty-v1"))
      .rejects.toMatchObject({ code: "authorization_persistence_unavailable" });
  });

  it("records decision retries once and detects conflicting decision IDs", async () => {
    const database = requiredRuntime(); const recorder = createPostgresAuthorizationPersistence(database).recorder;
    const decision: AuthorizationDecisionRecord = { action: "execute", allowed: true, decisionId: randomUUID(), evaluatedAt: "2026-07-28T03:00:00.000Z", operation: "check", permissionCode: "synthetic.operation:execute", policyVersion: "synthetic-v1", reason: "allowed", resource: "synthetic.operation", traceId: "1234567890abcdef1234567890abcdef" };
    await recorder.record(decision); await recorder.record(decision);
    expect((await database.execute("select * from authorization_core.decision_records where decision_id=$1", [decision.decisionId])).rowCount).toBe(1);
    await expect(recorder.record({ ...decision, allowed: false, reason: "no_applicable_grant" }))
      .rejects.toMatchObject({ code: "authorization_decision_conflict" });
    await expect(database.execute("delete from authorization_core.decision_records where decision_id=$1", [decision.decisionId]))
      .rejects.toMatchObject({ code: "55000" });
  });

  it("serializes concurrent mixed-content decision IDs to one fact and one conflict", async () => {
    const database = requiredRuntime(); const recorder = createPostgresAuthorizationPersistence(database).recorder;
    const decisionId = randomUUID(); const base: AuthorizationDecisionRecord = { action: "execute", allowed: true, decisionId, evaluatedAt: "2026-07-28T03:00:01.000Z", operation: "check", permissionCode: "synthetic.operation:execute", policyVersion: "synthetic-v1", reason: "allowed", resource: "synthetic.operation", traceId: "1234567890abcdef1234567890abcdef" };
    const outcomes = await Promise.allSettled([recorder.record(base), recorder.record({ ...base, allowed: false, reason: "no_applicable_grant" })]);
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected"); expect(rejected).toMatchObject({ reason: { code: "authorization_decision_conflict" }, status: "rejected" });
    expect((await database.execute("select * from authorization_core.decision_records where decision_id=$1", [decisionId])).rowCount).toBe(1);
  });
});

function requiredRuntime(): DatabaseRuntime { if (!runtime) throw new Error("PostgreSQL runtime is unavailable."); return runtime; }
