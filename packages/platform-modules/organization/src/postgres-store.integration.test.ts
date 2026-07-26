import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runMigrations } from "@ai-crm/database";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresOrganizationStore, type OrganizationPersistenceResult, type OrganizationPersistenceRuntime } from "./postgres-store.js";
import { OrganizationService } from "./service.js";

const urlFile = process.env.TEST_ORGANIZATION_DATABASE_URL_FILE;
const suite = describe.skipIf(!urlFile);

suite("PostgreSQL organization store", () => {
  let executor: TestExecutor;
  let pool: Pool;

  beforeAll(async () => {
    if (!urlFile) throw new Error("TEST_ORGANIZATION_DATABASE_URL_FILE is required.");
    const connectionString = (await readFile(resolve(urlFile), "utf8")).toString().trim();
    await runMigrations(connectionString, resolve(import.meta.dirname, "../../../database/migrations"));
    await runMigrations(connectionString, resolve(import.meta.dirname, "../migrations"));
    pool = new Pool({ application_name: "iam_02_integration", connectionString, max: 5 });
    await pool.query("create schema if not exists organization_test");
    await pool.query(`create table if not exists organization_test.audit_intents (
      operation_id uuid primary key, action text not null, actor_id text not null, actor_type text not null,
      entity_type text not null, entity_id uuid not null, reason text not null, result text not null, trace_id text not null
    )`);
    await pool.query(`create table if not exists organization_test.event_intents (
      operation_id uuid primary key, event_type text not null, entity_type text not null, entity_id uuid not null,
      workforce_person_id uuid, effective_at timestamptz not null, trace_id text not null
    )`);
    executor = new TestExecutor(pool);
  });

  afterAll(async () => { await pool.end(); });

  it("persists an effective context, audit intent, event intent, and idempotency receipt atomically", async () => {
    const service = new OrganizationService(createPostgresOrganizationStore(executor), allow);
    const fixture = ids();
    await seed(service, fixture);
    const context = await service.resolveWorkforceContext(fixture.subject, fixture.at);
    expect(context).toMatchObject({ workforcePersonId: fixture.person });
    expect(context.assignments).toHaveLength(1);
    const closedAt = "2026-08-01T00:00:00.000Z";
    await service.closeAssignment({ ...metadata(), effectiveTo: closedAt, factId: fixture.assignment });
    const closedEvent = await pool.query<{ effective_at: Date; entity_id: string; workforce_person_id: string }>(
      "select effective_at, entity_id, workforce_person_id from organization_test.event_intents where event_type = 'organization.assignment.closed.v1'",
    );
    expect(closedEvent.rows[0]).toMatchObject({ entity_id: fixture.assignment, workforce_person_id: fixture.person });
    expect(closedEvent.rows[0]?.effective_at.toISOString()).toBe(closedAt);

    const counts = await pool.query<{ audit: string; audit_succeeded: boolean; event: string; receipt: string }>(`select
      (select count(*) from organization_test.audit_intents)::text as audit,
      (select bool_and(result = 'succeeded') from organization_test.audit_intents) as audit_succeeded,
      (select count(*) from organization_test.event_intents)::text as event,
      (select count(*) from organization.operation_receipts)::text as receipt`);
    expect(Number(counts.rows[0]?.audit)).toBeGreaterThanOrEqual(6);
    expect(counts.rows[0]?.audit).toBe(counts.rows[0]?.event);
    expect(counts.rows[0]?.audit).toBe(counts.rows[0]?.receipt);
    expect(counts.rows[0]?.audit_succeeded).toBe(true);
  });

  it("rolls back state, receipt, and audit when event intent persistence fails", async () => {
    const service = new OrganizationService(createPostgresOrganizationStore(executor), allow);
    const person = randomUUID();
    const operationId = randomUUID();
    executor.failNextEvent = true;
    await expect(service.createWorkforcePerson({
      ...metadata(operationId), recordedAt: "2026-07-26T00:00:00.000Z", workforcePersonId: person,
    })).rejects.toThrow("synthetic event failure");
    const result = await pool.query<{ audit: string; person: string; receipt: string }>(`select
      (select count(*) from organization.workforce_people where workforce_person_id = $1)::text as person,
      (select count(*) from organization.operation_receipts where operation_id = $2)::text as receipt,
      (select count(*) from organization_test.audit_intents where operation_id = $2)::text as audit`, [person, operationId]);
    expect(result.rows[0]).toEqual({ audit: "0", person: "0", receipt: "0" });
  });

  it("fails closed when concurrent commands try to associate one subject to different people", async () => {
    const service = new OrganizationService(createPostgresOrganizationStore(executor), allow);
    const first = randomUUID();
    const second = randomUUID();
    const at = "2027-01-01T00:00:00.000Z";
    await service.createWorkforcePerson({ ...metadata(), recordedAt: at, workforcePersonId: first });
    await service.createWorkforcePerson({ ...metadata(), recordedAt: at, workforcePersonId: second });
    const shared = { issuer: "https://identity.example.test/realms/concurrency", subject: randomUUID() };
    const results = await Promise.allSettled([
      service.createSubjectAssociation({ ...metadata(), ...shared, associationId: randomUUID(), effectiveFrom: at, workforcePersonId: first }),
      service.createSubjectAssociation({ ...metadata(), ...shared, associationId: randomUUID(), effectiveFrom: at, workforcePersonId: second }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
  });

  it("rejects a database-level hierarchy cycle that starts at a future scheduled boundary", async () => {
    const first = randomUUID();
    const second = randomUUID();
    const at = "2028-01-01T00:00:00.000Z";
    const middle = "2028-02-01T00:00:00.000Z";
    const future = "2028-03-01T00:00:00.000Z";
    await pool.query("insert into organization.organization_units (organization_unit_id, effective_from) values ($1, $3), ($2, $3)", [first, second, at]);
    await pool.query(`insert into organization.organization_unit_placements
      (placement_id, organization_unit_id, effective_from, effective_to) values ($1, $2, $3, $4)`,
    [randomUUID(), first, at, middle]);
    await pool.query(`insert into organization.organization_unit_placements
      (placement_id, organization_unit_id, effective_from, effective_to) values ($1, $2, $3, $4)`,
    [randomUUID(), second, at, future]);
    await pool.query(`insert into organization.organization_unit_placements
      (placement_id, organization_unit_id, parent_organization_unit_id, effective_from) values ($1, $2, $3, $4)`,
    [randomUUID(), second, first, future]);
    const store = createPostgresOrganizationStore(executor);
    await expect(store.commit({
      actor: metadata().actor,
      auditAction: "organization_unit_placement_created",
      eventType: "organization.unit_placement.created.v1",
      fingerprint: "1".repeat(64),
      operationId: randomUUID(),
      reason: "synthetic future-cycle acceptance",
      traceId: "trace-future-cycle",
      write: {
        kind: "create_organization_unit_placement",
        placement: {
          effectiveFrom: middle,
          organizationUnitId: first,
          parentOrganizationUnitId: second,
          placementId: randomUUID(),
        },
      },
    })).rejects.toMatchObject({ code: "organization_hierarchy_cycle" });
  });
});

class TestExecutor implements OrganizationPersistenceRuntime {
  readonly #transaction = new AsyncLocalStorage<PoolClient>();
  failNextEvent = false;
  constructor(private readonly pool: Pool) {}

  async execute<Row>(sql: string, values?: readonly unknown[]): Promise<OrganizationPersistenceResult<Row>> {
    const result = await (this.#transaction.getStore() ?? this.pool).query(sql, values ? [...values] : undefined);
    return { rowCount: result.rowCount ?? 0, rows: result.rows as Row[] };
  }

  async recordAuditIntent(intent: Parameters<OrganizationPersistenceRuntime["recordAuditIntent"]>[0]): Promise<void> {
    await this.execute(`insert into organization_test.audit_intents
      (operation_id, action, actor_id, actor_type, entity_type, entity_id, reason, result, trace_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [intent.operationId, intent.action, intent.actorId, intent.actorType, intent.entityType, intent.entityId, intent.reason, intent.result, intent.traceId]);
  }

  async recordEventIntent(intent: Parameters<OrganizationPersistenceRuntime["recordEventIntent"]>[0]): Promise<void> {
    if (this.failNextEvent) {
      this.failNextEvent = false;
      throw new Error("synthetic event failure");
    }
    await this.execute(`insert into organization_test.event_intents
      (operation_id, event_type, entity_type, entity_id, workforce_person_id, effective_at, trace_id)
      values ($1, $2, $3, $4, $5, $6, $7)`,
    [intent.operationId, intent.eventType, intent.entityType, intent.entityId, intent.workforcePersonId ?? null, intent.effectiveAt, intent.traceId]);
  }

  async withTransaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.#transaction.getStore()) return work();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await this.#transaction.run(client, work);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

const metadata = (operationId = randomUUID()) => ({
  actor: { actorId: "synthetic-admin", actorType: "system" as const }, operationId,
  reason: "synthetic IAM-02 PostgreSQL acceptance", traceId: "trace-iam-02-postgres",
});
const allow = { authorize: () => Promise.resolve() };

function ids() {
  return {
    assignment: randomUUID(), association: randomUUID(), at: "2026-07-26T00:00:00.000Z",
    employment: randomUUID(), person: randomUUID(), placement: randomUUID(), position: randomUUID(),
    subject: { issuer: "https://identity.example.test/realms/ai-crm", subject: randomUUID() }, unit: randomUUID(),
  };
}

async function seed(service: OrganizationService, fixture: ReturnType<typeof ids>): Promise<void> {
  await service.createWorkforcePerson({ ...metadata(), recordedAt: fixture.at, workforcePersonId: fixture.person });
  await service.createEmployment({ ...metadata(), effectiveFrom: fixture.at, employmentId: fixture.employment, workforcePersonId: fixture.person });
  await service.createOrganizationUnit({ ...metadata(), effectiveFrom: fixture.at, organizationUnitId: fixture.unit, placementId: fixture.placement });
  await service.createPosition({ ...metadata(), effectiveFrom: fixture.at, organizationUnitId: fixture.unit, positionId: fixture.position });
  await service.createAssignment({ ...metadata(), assignmentId: fixture.assignment, effectiveFrom: fixture.at, employmentId: fixture.employment, organizationUnitId: fixture.unit, positionId: fixture.position, workforcePersonId: fixture.person });
  await service.createSubjectAssociation({ ...metadata(), ...fixture.subject, associationId: fixture.association, effectiveFrom: fixture.at, workforcePersonId: fixture.person });
}
