import { describe, expect, it } from "vitest";

import { AuthorizationPersistenceError } from "./errors.js";
import {
  authorizationPolicyDigest,
  canonicalizeAuthorizationPolicy,
  createPostgresAuthorizationPersistence,
} from "./postgres-persistence.js";
import { syntheticPolicySnapshot } from "./testing.js";
import type {
  AuthorizationDecisionRecord,
  AuthorizationPersistenceResult,
  AuthorizationPersistenceRuntime,
  AuthorizationPolicySnapshot,
} from "./types.js";

interface VersionState { content_digest: string; contract_version: string; snapshot: unknown; version: string }
interface PublicationState { fingerprint: string; policyVersion: string; result: unknown }

class MemorySqlRuntime implements AuthorizationPersistenceRuntime {
  public current: { content_digest: string; publicationId: string; version: string } | undefined;
  public readonly decisions = new Map<string, string>();
  public readonly publications = new Map<string, PublicationState>();
  public readonly versions = new Map<string, VersionState>();
  public failReadback = false;
  public transactionRollbacks = 0;

  public async execute<Row = Record<string, unknown>>(sql: string, values: readonly unknown[] = []): Promise<AuthorizationPersistenceResult<Row>> {
    await Promise.resolve();
    if (sql.startsWith("select pg_advisory_xact_lock")) return result([]);
    if (sql.startsWith("select fingerprint,result from authorization_core.policy_publications")) {
      const found = this.publications.get(String(values[0]));
      return result(found ? [{ fingerprint: found.fingerprint, result: found.result }] : []) as AuthorizationPersistenceResult<Row>;
    }
    if (sql.startsWith("select") && sql.includes("from authorization_core.policy_versions")) {
      if (this.failReadback && !sql.includes("exists")) return result([]);
      const found = this.versions.get(String(values[0]));
      const published = found && [...this.publications.values()].some(({ policyVersion }) => policyVersion === found.version);
      return result(found && (!sql.includes("exists") || published) ? [found] : []) as AuthorizationPersistenceResult<Row>;
    }
    if (sql.startsWith("insert into authorization_core.policy_versions")) {
      this.versions.set(String(values[0]), { content_digest: String(values[2]), contract_version: String(values[1]), snapshot: JSON.parse(String(values[3])) as unknown, version: String(values[0]) });
      return result([]);
    }
    if (sql.startsWith("select version,content_digest from authorization_core.current_policy")) {
      return result(this.current ? [{ content_digest: this.current.content_digest, version: this.current.version }] : []) as AuthorizationPersistenceResult<Row>;
    }
    if (sql.startsWith("select c.version,c.content_digest")) {
      const version = this.current && this.versions.get(this.current.version);
      return result(this.current ? [{ content_digest: this.current.content_digest, contract_version: version?.contract_version, version: this.current.version }] : []) as AuthorizationPersistenceResult<Row>;
    }
    if (sql.startsWith("insert into authorization_core.policy_publications")) {
      this.publications.set(String(values[0]), { fingerprint: String(values[1]), policyVersion: String(values[2]), result: JSON.parse(String(values[6])) as unknown });
      return result([]);
    }
    if (sql.startsWith("insert into authorization_core.current_policy")) {
      this.current = { content_digest: String(values[1]), publicationId: String(values[2]), version: String(values[0]) };
      return result([]);
    }
    if (sql.startsWith("insert into authorization_core.decision_records")) {
      const id = String(values[0]);
      if (this.decisions.has(id)) return result([]);
      this.decisions.set(id, String(values[1]));
      return result([{ record_digest: String(values[1]) }]) as AuthorizationPersistenceResult<Row>;
    }
    if (sql.startsWith("select record_digest from authorization_core.decision_records")) {
      const found = this.decisions.get(String(values[0]));
      return result(found ? [{ record_digest: found }] : []) as AuthorizationPersistenceResult<Row>;
    }
    throw new Error(`Unexpected SQL in test: ${sql}`);
  }

  public async withTransaction<T>(work: () => Promise<T>): Promise<T> {
    const before = structuredClone({ current: this.current, decisions: [...this.decisions], publications: [...this.publications], versions: [...this.versions] });
    try { return await work(); }
    catch (error) {
      this.current = before.current;
      this.decisions.clear(); for (const entry of before.decisions) this.decisions.set(...entry);
      this.publications.clear(); for (const entry of before.publications) this.publications.set(...entry);
      this.versions.clear(); for (const entry of before.versions) this.versions.set(...entry);
      this.transactionRollbacks += 1;
      throw error;
    }
  }
}

const result = <Row>(rows: readonly Row[]): AuthorizationPersistenceResult<Row> => ({ rowCount: rows.length, rows });
const command = (snapshot: AuthorizationPolicySnapshot = syntheticPolicySnapshot()) => ({
  contractVersion: "authorization-policy.v1", publicationId: "60000000-0000-4000-8000-000000000001",
  publishedAt: "2026-07-28T00:00:00.000Z", snapshot,
});
const decision = (): AuthorizationDecisionRecord => ({
  action: "execute", allowed: true, decisionId: "61000000-0000-4000-8000-000000000001",
  evaluatedAt: "2026-07-28T00:00:01.000Z", operation: "check", permissionCode: "synthetic.operation:execute",
  policyVersion: "synthetic-v1", reason: "allowed", resource: "synthetic.operation",
  traceId: "1234567890abcdef1234567890abcdef", workforcePersonId: "50000000-0000-4000-8000-000000000003",
});

describe("PostgreSQL authorization persistence", () => {
  it("canonicalizes semantically reordered complete policies to one digest", () => {
    const left = syntheticPolicySnapshot();
    const right = { ...left, grants: [...left.grants].reverse(), permissions: [...left.permissions].reverse(), roles: [...left.roles].reverse() };
    expect(authorizationPolicyDigest(left)).toBe(authorizationPolicyDigest(right));
    expect(canonicalizeAuthorizationPolicy(right)).toEqual(canonicalizeAuthorizationPolicy(left));
  });

  it("uses locale-independent code-unit ordering for digest material", () => {
    const base = syntheticPolicySnapshot(); const firstRole = base.roles[0]; const firstBinding = firstRole?.permissions[0];
    if (!firstRole || !firstBinding) throw new Error("synthetic fixture is incomplete");
    const terms = ["a", "Z"].map((value) => ({ constraints: [{ dimension: "synthetic.partition", values: [value] }], kind: "match" as const }));
    const left: AuthorizationPolicySnapshot = { ...base, roles: [{ ...firstRole, permissions: [{ ...firstBinding, scope: { terms, version: 1 } }] }, ...base.roles.slice(1)] };
    const right: AuthorizationPolicySnapshot = { ...left, roles: [{ ...firstRole, permissions: [{ ...firstBinding, scope: { terms: [...terms].reverse(), version: 1 } }] }, ...base.roles.slice(1)] };
    expect(authorizationPolicyDigest(left)).toBe(authorizationPolicyDigest(right));
    const normalized = canonicalizeAuthorizationPolicy(left); const normalizedTerm = normalized.roles[0]?.permissions[0]?.scope.terms[0];
    expect(normalizedTerm).toMatchObject({ constraints: [{ values: ["Z"] }], kind: "match" });
  });

  it.each(["permissions", "roles", "grants"] as const)("rejects an empty %s set before persistence", async (key) => {
    const runtime = new MemorySqlRuntime();
    const snapshot = { ...syntheticPolicySnapshot(), [key]: [] };
    await expect(createPostgresAuthorizationPersistence(runtime).publisher.publish(command(snapshot)))
      .rejects.toMatchObject({ code: "authorization_policy_invalid" });
    expect(runtime.versions.size).toBe(0);
  });

  it("rejects unsupported policy contract versions on publish and load", async () => {
    const runtime = new MemorySqlRuntime(); const persistence = createPostgresAuthorizationPersistence(runtime);
    await expect(persistence.publisher.publish({ ...command(), contractVersion: "authorization-policy.v2" }))
      .rejects.toMatchObject({ code: "authorization_policy_invalid" });
    await persistence.publisher.publish(command());
    const stored = runtime.versions.get("synthetic-v1"); if (!stored) throw new Error("stored fixture");
    stored.contract_version = "authorization-policy.v2";
    await expect(persistence.store.currentVersion()).rejects.toMatchObject({ code: "authorization_persistence_unavailable" });
    await expect(persistence.store.load("synthetic-v1")).rejects.toMatchObject({ code: "authorization_persistence_unavailable" });
  });

  it("publishes atomically and replays an identical intent without moving current state", async () => {
    const runtime = new MemorySqlRuntime(); const persistence = createPostgresAuthorizationPersistence(runtime);
    const first = await persistence.publisher.publish(command());
    expect(first).toMatchObject({ replayed: false, version: "synthetic-v1" });
    expect(await persistence.store.currentVersion()).toBe("synthetic-v1");
    expect(await persistence.store.load("synthetic-v1")).toEqual(canonicalizeAuthorizationPolicy(syntheticPolicySnapshot()));
    await expect(persistence.publisher.publish(command())).resolves.toEqual({ ...first, replayed: true });
    expect(runtime.publications.size).toBe(1);
  });

  it("enforces the current-policy precondition inside the serialized publication transaction", async () => {
    const runtime = new MemorySqlRuntime(); const publisher = createPostgresAuthorizationPersistence(runtime).publisher;
    await expect(publisher.publish({ ...command(), expectedPreviousVersion: null })).resolves.toMatchObject({ version: "synthetic-v1" });
    const replacement = { ...syntheticPolicySnapshot(), version: "synthetic-v2" };
    await expect(publisher.publish({ ...command(replacement), expectedPreviousVersion: null,
      publicationId: "60000000-0000-4000-8000-000000000002" }))
      .rejects.toMatchObject({ code: "authorization_policy_conflict" });
    await expect(publisher.publish({ ...command(replacement), expectedPreviousVersion: "stale-v1",
      publicationId: "60000000-0000-4000-8000-000000000003" }))
      .rejects.toMatchObject({ code: "authorization_policy_conflict" });
    await expect(publisher.publish({ ...command(replacement), expectedPreviousVersion: "synthetic-v1",
      publicationId: "60000000-0000-4000-8000-000000000004" }))
      .resolves.toMatchObject({ previousVersion: "synthetic-v1", version: "synthetic-v2" });
  });

  it("rejects publication-id and version-content conflicts", async () => {
    const runtime = new MemorySqlRuntime(); const publisher = createPostgresAuthorizationPersistence(runtime).publisher;
    await publisher.publish(command());
    await expect(publisher.publish({ ...command(), publishedAt: "2026-07-28T00:00:02.000Z" }))
      .rejects.toMatchObject({ code: "authorization_policy_conflict" });
    const changed = syntheticPolicySnapshot();
    const firstRole = changed.roles[0]; if (!firstRole) throw new Error("fixture");
    const other = { ...changed, roles: [{ ...firstRole, permissions: [...firstRole.permissions].reverse() }, ...changed.roles.slice(1)] };
    const stored = runtime.versions.get("synthetic-v1"); if (!stored) throw new Error("stored fixture");
    stored.content_digest = "f".repeat(64);
    await expect(publisher.publish({ ...command(other), publicationId: "60000000-0000-4000-8000-000000000002" }))
      .rejects.toMatchObject({ code: "authorization_policy_conflict" });
  });

  it("rolls back all publication facts when complete readback cannot be verified", async () => {
    const runtime = new MemorySqlRuntime(); runtime.failReadback = true;
    await expect(createPostgresAuthorizationPersistence(runtime).publisher.publish(command()))
      .rejects.toBeInstanceOf(AuthorizationPersistenceError);
    expect(runtime.transactionRollbacks).toBe(1);
    expect(runtime.versions.size).toBe(0); expect(runtime.publications.size).toBe(0); expect(runtime.current).toBeUndefined();
  });

  it("fails closed for missing, corrupted, or unpublished policy data", async () => {
    const runtime = new MemorySqlRuntime(); const store = createPostgresAuthorizationPersistence(runtime).store;
    await expect(store.currentVersion()).rejects.toMatchObject({ code: "authorization_persistence_unavailable" });
    runtime.versions.set("synthetic-v1", { content_digest: "0".repeat(64), contract_version: "authorization-policy.v1", snapshot: syntheticPolicySnapshot(), version: "synthetic-v1" });
    await expect(store.load("synthetic-v1")).rejects.toMatchObject({ code: "authorization_persistence_unavailable" });
    runtime.publications.set("60000000-0000-4000-8000-000000000001", { fingerprint: "0".repeat(64), policyVersion: "synthetic-v1", result: {} });
    await expect(store.load("synthetic-v1")).rejects.toMatchObject({ code: "authorization_persistence_unavailable" });
  });

  it("records identical decisions idempotently and rejects conflicting reuse", async () => {
    const runtime = new MemorySqlRuntime(); const persistence = createPostgresAuthorizationPersistence(runtime);
    await persistence.publisher.publish(command()); const recorder = persistence.recorder;
    await recorder.record(decision()); await recorder.record(decision()); expect(runtime.decisions.size).toBe(1);
    await expect(recorder.record({ ...decision(), allowed: false, reason: "no_applicable_grant" }))
      .rejects.toMatchObject({ code: "authorization_decision_conflict" });
  });

  it("enforces allowed/reason consistency and validates policy authority for evaluated denials", async () => {
    const runtime = new MemorySqlRuntime(); const recorder = createPostgresAuthorizationPersistence(runtime).recorder;
    await expect(recorder.record({ ...decision(), allowed: false })).rejects.toMatchObject({ code: "authorization_decision_conflict" });
    await expect(recorder.record(decision())).rejects.toMatchObject({ code: "authorization_persistence_unavailable" });
    await expect(recorder.record({ ...decision(), allowed: false, policyVersion: "missing-v1", reason: "no_applicable_grant" }))
      .rejects.toMatchObject({ code: "authorization_persistence_unavailable" });
    await expect(recorder.record({ ...decision(), allowed: false, policyVersion: "unavailable", reason: "no_applicable_grant" }))
      .rejects.toMatchObject({ code: "authorization_decision_conflict" });
    await expect(recorder.record({ ...decision(), allowed: false, policyVersion: "unavailable", reason: "policy_unavailable" })).resolves.toBeUndefined();
    expect(runtime.decisions.size).toBe(1);
  });

  it("maps regex-shaped but calendar-invalid decision timestamps to a stable conflict", async () => {
    const runtime = new MemorySqlRuntime(); const recorder = createPostgresAuthorizationPersistence(runtime).recorder;
    const invalid = { ...decision(), allowed: false, evaluatedAt: "2026-99-99T00:00:00.000Z", reason: "policy_unavailable" as const };
    await expect(recorder.record(invalid)).rejects.toMatchObject({ code: "authorization_decision_conflict" });
    expect(runtime.decisions.size).toBe(0);
  });

  it("does not expose an underlying database error as a public cause", async () => {
    const raw = new Error("raw SQL and credential material");
    const runtime: AuthorizationPersistenceRuntime = { execute: () => Promise.reject(raw), withTransaction: (work) => work() };
    const failure = await createPostgresAuthorizationPersistence(runtime).store.currentVersion().catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "authorization_persistence_unavailable" });
    expect(failure).not.toHaveProperty("cause"); expect(String(failure)).not.toContain(raw.message);
    const transactionRuntime: AuthorizationPersistenceRuntime = { execute: () => Promise.resolve(result([])), withTransaction: () => Promise.reject(raw) };
    const publicationFailure = await createPostgresAuthorizationPersistence(transactionRuntime).publisher.publish(command()).catch((error: unknown) => error);
    expect(publicationFailure).toMatchObject({ code: "authorization_persistence_unavailable" });
    expect(publicationFailure).not.toHaveProperty("cause"); expect(String(publicationFailure)).not.toContain(raw.message);
  });
});
