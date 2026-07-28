import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createPostgresRuntimeRoleCapabilityProbe, type RuntimeRoleCapabilityRuntime } from "./runtime-role-capability.js";
import { runMigrations } from "./migrations.js";

const adminPasswordFile = process.env.TEST_DATABASE_ADMIN_PASSWORD_FILE;
const migrationUrlFile = process.env.TEST_DATABASE_MIGRATION_URL_FILE;
const runtimePasswordFile = process.env.TEST_DATABASE_RUNTIME_PASSWORD_FILE;

const directories = [
  resolve(import.meta.dirname, "../migrations"),
  ...[
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
  ].map((name) => resolve(import.meta.dirname, `../../platform-modules/${name}/migrations`)),
];

function runtime(executor: Pool): RuntimeRoleCapabilityRuntime {
  return {
    async execute<Row = Record<string, unknown>>(sql: string, values?: readonly unknown[]) {
      const result = await executor.query(sql, values === undefined ? undefined : [...values]);
      return { rowCount: result.rowCount ?? 0, rows: result.rows as readonly Row[] };
    },
  };
}

describe.skipIf(!adminPasswordFile || !migrationUrlFile || !runtimePasswordFile)(
  "PostgreSQL runtime-role capability probe",
  () => {
    it("accepts only ai_crm_runtime without powerful attributes or inherited roles", async () => {
      if (!adminPasswordFile || !migrationUrlFile || !runtimePasswordFile) {
        throw new Error("Runtime-role capability integration inputs are required.");
      }
      const migrationConnectionString = (await readFile(resolve(migrationUrlFile), "utf8")).trim();
      await runMigrations(migrationConnectionString, directories);
      const runtimeUrl = new URL(migrationConnectionString);
      runtimeUrl.username = "ai_crm_runtime";
      runtimeUrl.password = (await readFile(resolve(runtimePasswordFile), "utf8")).trim();
      const adminUrl = new URL(migrationConnectionString);
      adminUrl.username = "ai_crm_admin";
      adminUrl.password = (await readFile(resolve(adminPasswordFile), "utf8")).trim();
      const admin = new Pool({ connectionString: adminUrl.href, max: 1 });
      const migration = new Pool({ connectionString: migrationConnectionString, max: 1 });
      const runtimePool = new Pool({ connectionString: runtimeUrl.href, max: 1 });
      try {
        await expect(createPostgresRuntimeRoleCapabilityProbe(runtime(runtimePool)).check())
          .resolves.toEqual({ status: "available" });
        await expect(createPostgresRuntimeRoleCapabilityProbe(runtime(migration)).check())
          .resolves.toEqual({ status: "unavailable" });

        await admin.query("create role ai_crm_probe_extra nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls");
        await admin.query("set role ai_crm_probe_extra");
        await expect(createPostgresRuntimeRoleCapabilityProbe(runtime(admin)).check())
          .resolves.toEqual({ status: "unavailable" });
        await admin.query("reset role");

        await admin.query("create role ai_crm_probe_inherited nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls");
        await admin.query("grant ai_crm_probe_inherited to ai_crm_runtime");
        await expect(createPostgresRuntimeRoleCapabilityProbe(runtime(runtimePool)).check())
          .resolves.toEqual({ status: "unavailable" });
      } finally {
        await admin.query("reset role").catch(() => undefined);
        await admin.query("revoke ai_crm_probe_inherited from ai_crm_runtime").catch(() => undefined);
        await admin.query("drop role if exists ai_crm_probe_inherited").catch(() => undefined);
        await admin.query("drop role if exists ai_crm_probe_extra").catch(() => undefined);
        await Promise.all([runtimePool.end(), migration.end(), admin.end()]);
      }
    });
  },
);
