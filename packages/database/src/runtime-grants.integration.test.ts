import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { runMigrations } from "./migrations.js";

const migrationUrlFile = process.env.TEST_DATABASE_MIGRATION_URL_FILE;
const runtimePasswordFile = process.env.TEST_DATABASE_RUNTIME_PASSWORD_FILE;
const workerRuntimePasswordFile = process.env.TEST_DATABASE_WORKER_RUNTIME_PASSWORD_FILE;

const moduleNames = [
  "organization",
  "eventing-outbox",
  "task-center",
  "audit",
  "app-registry",
  "form-schema",
  "business-configuration",
  "notifications",
  "file-center",
  "authorization",
] as const;

const directories = [
  resolve(import.meta.dirname, "../migrations"),
  ...moduleNames.map((name) => resolve(import.meta.dirname, `../../platform-modules/${name}/migrations`)),
];

function expectDatabaseDenial(error: unknown): void {
  expect(error).toMatchObject({ code: "42501" });
}

async function assertRuntimeRolesExist(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await expect(pool.query("select rolname from pg_catalog.pg_roles where rolname in ('ai_crm_runtime','ai_crm_worker_runtime') order by rolname"))
      .resolves.toMatchObject({ rows: [{ rolname: "ai_crm_runtime" }, { rolname: "ai_crm_worker_runtime" }] });
  } finally {
    await pool.end();
  }
}

describe.skipIf(!migrationUrlFile || !runtimePasswordFile || !workerRuntimePasswordFile)("PostgreSQL runtime grants", () => {
  it("allows only the SQL paths composed into the production API and Task projection Worker", async () => {
    if (!migrationUrlFile || !runtimePasswordFile || !workerRuntimePasswordFile) throw new Error("Runtime grant integration inputs are required.");
    const migrationConnectionString = (await readFile(resolve(migrationUrlFile), "utf8")).trim();
    const runtimePassword = (await readFile(resolve(runtimePasswordFile), "utf8")).trim();
    const workerRuntimePassword = (await readFile(resolve(workerRuntimePasswordFile), "utf8")).trim();
    await assertRuntimeRolesExist(migrationConnectionString);
    await runMigrations(migrationConnectionString, directories);

    const runtimeUrl = new URL(migrationConnectionString);
    runtimeUrl.username = "ai_crm_runtime";
    runtimeUrl.password = runtimePassword;
    const migration = new Pool({ connectionString: migrationConnectionString, max: 1 });
    const runtime = new Pool({ connectionString: runtimeUrl.href, max: 1 });
    const workerUrl = new URL(migrationConnectionString);
    workerUrl.username = "ai_crm_worker_runtime";
    workerUrl.password = workerRuntimePassword;
    const worker = new Pool({ connectionString: workerUrl.href, max: 1 });
    try {
      const policyVersion = "runtime-grants-policy-v1";
      const digest = "a".repeat(64);
      const publicationId = "10000000-0000-4000-8000-000000000013";
      await migration.query(
        "insert into authorization_core.policy_versions(version,contract_version,content_digest,snapshot,created_at) values($1,'authorization-policy.v1',$2,$3::jsonb,'2026-07-28T00:00:00.000Z') on conflict(version) do nothing",
        [policyVersion, digest, JSON.stringify({ grants: [], permissions: [], roles: [], version: policyVersion })],
      );
      await migration.query(
        "insert into authorization_core.policy_publications(publication_id,fingerprint,policy_version,content_digest,published_at,result) values($1,$2,$3,$2,'2026-07-28T00:00:00.000Z',$4::jsonb) on conflict(publication_id) do nothing",
        [publicationId, digest, policyVersion, JSON.stringify({ contentDigest: digest, publicationId, publishedAt: "2026-07-28T00:00:00.000Z", version: policyVersion })],
      );
      await migration.query(
        "insert into authorization_core.current_policy(singleton,version,content_digest,publication_id,updated_at) values(true,$1,$2,$3,'2026-07-28T00:00:00.000Z') on conflict(singleton) do update set version=excluded.version,content_digest=excluded.content_digest,publication_id=excluded.publication_id,updated_at=excluded.updated_at",
        [policyVersion, digest, publicationId],
      );

      await expect(runtime.query("select version from ai_crm_migrations.applied_migrations order by version desc limit 1"))
        .resolves.toMatchObject({ rows: [{ version: "0000000015" }] });
      await expect(runtime.query(
        "select has_database_privilege(current_user,current_database(),'CONNECT') as connect,has_database_privilege(current_user,current_database(),'TEMP') as temporary,has_schema_privilege(current_user,'public','USAGE') as public_usage,has_function_privilege(current_user,'pg_catalog.hashtextextended(text,bigint)','EXECUTE') as hash_execute,has_function_privilege(current_user,'pg_catalog.pg_advisory_xact_lock(bigint)','EXECUTE') as lock_execute",
      )).resolves.toMatchObject({
        rows: [{ connect: true, hash_execute: true, lock_execute: true, public_usage: false, temporary: false }],
      });
      for (const relation of [
        "organization.assignments",
        "organization.employments",
        "organization.organization_unit_placements",
        "organization.organization_units",
        "organization.positions",
        "organization.subject_associations",
        "app_registry.applications",
        "app_registry.navigation",
        "app_registry.routes",
        "form_schema.releases",
        "form_schema.release_status",
        "file_center.files",
        "file_center.content_versions",
        "platform_notifications.in_app_notifications",
        "platform_task_center.task_projections",
      ]) {
        await expect(runtime.query(`select * from ${relation} limit 0`)).resolves.toMatchObject({ rowCount: 0 });
      }
      await expect(runtime.query(
        "select c.version from authorization_core.current_policy c join authorization_core.policy_versions v on v.version=c.version join authorization_core.policy_publications p on p.publication_id=c.publication_id where c.singleton=true",
      )).resolves.toMatchObject({ rows: [{ version: policyVersion }] });

      for (const [relation, privileges] of [
        ["file_center.files", ["SELECT", "INSERT"]],
        ["file_center.content_versions", ["SELECT", "INSERT", "UPDATE"]],
        ["file_center.upload_sessions", ["SELECT", "INSERT", "UPDATE"]],
        ["file_center.operation_receipts", ["SELECT", "INSERT", "UPDATE"]],
        ["file_center.resource_links", ["SELECT"]],
        ["file_center.outbox_events", ["INSERT"]],
        ["platform_notifications.in_app_notifications", ["SELECT"]],
        ["platform_task_center.task_projections", ["SELECT"]],
      ] as const) {
        for (const privilege of privileges) {
          await expect(runtime.query("select has_table_privilege(current_user,$1,$2) as allowed", [relation, privilege]))
            .resolves.toMatchObject({ rows: [{ allowed: true }] });
        }
      }
      for (const [relation, privilege] of [
        ["file_center.files", "UPDATE"],
        ["file_center.resource_links", "INSERT"],
        ["file_center.outbox_events", "SELECT"],
        ["platform_notifications.in_app_notifications", "INSERT"],
        ["platform_task_center.task_projections", "UPDATE"],
      ] as const) {
        await expect(runtime.query("select has_table_privilege(current_user,$1,$2) as allowed", [relation, privilege]))
          .resolves.toMatchObject({ rows: [{ allowed: false }] });
      }

      for (const relation of [
        "ai_crm_migrations.applied_migrations",
        "platform_eventing.inbox_receipts",
        "platform_eventing.outbox_messages",
        "platform_task_center.task_projections",
        "platform_task_center.projection_events",
      ]) {
        await expect(worker.query(`select * from ${relation} limit 0`)).resolves.toMatchObject({ rowCount: 0 });
      }
      await expect(worker.query(
        "select has_database_privilege(current_user,current_database(),'CONNECT') as connect,has_database_privilege(current_user,current_database(),'TEMP') as temporary,has_schema_privilege(current_user,'public','USAGE') as public_usage",
      )).resolves.toMatchObject({ rows: [{ connect: true, public_usage: false, temporary: false }] });
      for (const [relation, privileges] of [
        ["ai_crm_migrations.applied_migrations", ["SELECT"]],
        ["platform_eventing.inbox_receipts", ["SELECT", "INSERT"]],
        ["platform_eventing.isolations", ["INSERT"]],
        ["platform_eventing.outbox_messages", ["SELECT", "UPDATE"]],
        ["platform_task_center.task_projections", ["SELECT", "INSERT", "UPDATE"]],
        ["platform_task_center.projection_events", ["SELECT", "INSERT"]],
      ] as const) {
        for (const privilege of privileges) {
          await expect(worker.query(
            "select has_table_privilege(current_user,$1,$2) as allowed",
            [relation, privilege],
          )).resolves.toMatchObject({ rows: [{ allowed: true }] });
        }
      }
      for (const [relation, privilege] of [
        ["platform_eventing.inbox_receipts", "UPDATE"],
        ["platform_eventing.isolations", "SELECT"],
        ["platform_eventing.outbox_messages", "INSERT"],
        ["platform_task_center.projection_events", "UPDATE"],
      ] as const) {
        await expect(worker.query(
          "select has_table_privilege(current_user,$1,$2) as allowed",
          [relation, privilege],
        )).resolves.toMatchObject({ rows: [{ allowed: false }] });
      }
      await expect(worker.query("select * from organization.workforce_people limit 0"))
        .rejects.toMatchObject({ code: "42501" });
      await worker.query("insert into platform_eventing.isolations(isolation_id,message_id,consumer,payload_sha256,reason_code,attempt_count,isolated_at) values($1,$2,'platform.task-center.projection.v1',$3,'terminal',1,now())", [
        "81000000-0000-4000-8000-000000000014", "82000000-0000-4000-8000-000000000014", "d".repeat(64),
      ]);

      const decisionId = "20000000-0000-4000-8000-000000000013";
      await expect(runtime.query(
        "insert into authorization_core.decision_records(decision_id,record_digest,evaluated_at,operation,resource,action,permission_code,allowed,reason,policy_version,trace_id) values($1,$2,'2026-07-28T00:01:00.000Z','check','platform.application-registry.application','read','platform.application-registry.application:read',true,'allowed',$3,$4)",
        [decisionId, "b".repeat(64), policyVersion, "1".repeat(32)],
      )).resolves.toMatchObject({ rowCount: 1 });

      const auditClient = await runtime.connect();
      try {
        await auditClient.query("begin");
        await auditClient.query("select pg_advisory_xact_lock(hashtextextended($1::text,0))", [
          "30000000-0000-4000-8000-000000000013",
        ]);
        await auditClient.query(
          "select audit_id from audit.operation_receipts where operation_id=$1 for update",
          ["30000000-0000-4000-8000-000000000013"],
        );
        await auditClient.query(
          "insert into audit.records(audit_id,occurred_at,action,actor_id,actor_type,resource_type,resource_id,result,reason_code,trace_id,operation_id) values($1,'2026-07-28T00:02:00.000Z','authentication.login','api.pc_bff','system','authentication_attempt','login','succeeded','authentication_event',$2,$3)",
          ["40000000-0000-4000-8000-000000000013", "2".repeat(32), "30000000-0000-4000-8000-000000000013"],
        );
        await auditClient.query(
          "insert into audit.operation_receipts(operation_id,audit_id,fingerprint) values($1,$2,$3)",
          ["30000000-0000-4000-8000-000000000013", "40000000-0000-4000-8000-000000000013", "c".repeat(64)],
        );
        await auditClient.query("commit");
      } catch (error) {
        await auditClient.query("rollback");
        throw error;
      } finally {
        auditClient.release();
      }
    } finally {
      await Promise.all([runtime.end(), worker.end(), migration.end()]);
    }
  });

  it("denies cross-schema access, runtime DDL, and unauthorized writes", async () => {
    if (!migrationUrlFile || !runtimePasswordFile || !workerRuntimePasswordFile) throw new Error("Runtime grant integration inputs are required.");
    const migrationConnectionString = (await readFile(resolve(migrationUrlFile), "utf8")).trim();
    const runtimePassword = (await readFile(resolve(runtimePasswordFile), "utf8")).trim();
    await assertRuntimeRolesExist(migrationConnectionString);
    await runMigrations(migrationConnectionString, directories);
    const runtimeUrl = new URL(migrationConnectionString);
    runtimeUrl.username = "ai_crm_runtime";
    runtimeUrl.password = runtimePassword;
    const migration = new Pool({ connectionString: migrationConnectionString, max: 1 });
    const runtime = new Pool({ connectionString: runtimeUrl.href, max: 1 });
    try {
      await migration.query(
        "insert into audit.records(audit_id,occurred_at,action,actor_id,actor_type,resource_type,resource_id,result,reason_code,trace_id,operation_id) values($1,'2026-07-28T00:03:00.000Z','runtime.grant.test','database-test','system','runtime_grant','audit-update','succeeded','permission_test',$2,$3) on conflict(audit_id) do nothing",
        ["60000000-0000-4000-8000-000000000013", "3".repeat(32), "70000000-0000-4000-8000-000000000013"],
      );
      await migration.query(
        "insert into audit.operation_receipts(operation_id,audit_id,fingerprint) values($1,$2,$3) on conflict(operation_id) do nothing",
        ["70000000-0000-4000-8000-000000000013", "60000000-0000-4000-8000-000000000013", "f".repeat(64)],
      );
      for (const sql of [
        "select * from business_configuration.dictionary_releases limit 0",
        "select * from platform_eventing.inbox_receipts limit 0",
        "select * from platform_eventing.job_requests limit 0",
        "select * from platform_notifications.notification_intents limit 0",
        "select * from platform_task_center.projection_events limit 0",
        "select * from platform_task_center.task_commands limit 0",
        "select * from organization.workforce_people limit 0",
        "insert into organization.workforce_people(workforce_person_id,recorded_at) values('50000000-0000-4000-8000-000000000013',now())",
        "update app_registry.applications set enabled=false",
        "insert into form_schema.releases(definition_id,release_version,owner_module,content_digest,json_schema,ui_schema,published_at) values('forbidden',1,'test',repeat('d',64),'{}','{}',now())",
        "insert into authorization_core.policy_versions(version,contract_version,content_digest,snapshot,created_at) values('forbidden','authorization-policy.v1',repeat('e',64),'{}',now())",
        "update audit.records set action='forbidden'",
        "create schema runtime_forbidden",
        "create table public.runtime_forbidden(id integer)",
        "create temporary table runtime_forbidden(id integer)",
      ]) {
        await runtime.query(sql).then(
          () => { throw new Error(`Expected database denial for: ${sql}`); },
          expectDatabaseDenial,
        );
      }
      await expect(runtime.query(
        "update audit.operation_receipts set fingerprint=$2 where operation_id=$1",
        ["70000000-0000-4000-8000-000000000013", "0".repeat(64)],
      )).rejects.toMatchObject({ code: "55000" });
    } finally {
      await Promise.all([runtime.end(), migration.end()]);
    }
  });
});
