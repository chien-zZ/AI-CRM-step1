import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { runMigrations } from "./migrations.js";

const missingRoleUrlFile = process.env.TEST_DATABASE_MISSING_ROLE_URL_FILE;

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

describe.skipIf(!missingRoleUrlFile)("PostgreSQL runtime-role migration prerequisite", () => {
  it("records each grant migration only after its fixed runtime role exists", async () => {
    if (!missingRoleUrlFile) throw new Error("Missing-role PostgreSQL URL file is required.");
    const connectionString = (await readFile(resolve(missingRoleUrlFile), "utf8")).trim();
    await expect(runMigrations(connectionString, directories)).rejects.toMatchObject({ code: "42704" });

    const pool = new Pool({ connectionString, max: 1 });
    try {
      await expect(pool.query(
        "select version from ai_crm_migrations.applied_migrations where version='0000000013'",
      )).resolves.toMatchObject({ rowCount: 0, rows: [] });
      await pool.query(
        "create role ai_crm_runtime login nosuperuser nocreatedb nocreaterole noreplication nobypassrls",
      );
    } finally {
      await pool.end();
    }

    await expect(runMigrations(connectionString, directories)).rejects.toMatchObject({ code: "42704" });
    const verification = new Pool({ connectionString, max: 1 });
    try {
      await expect(verification.query(
        "select version from ai_crm_migrations.applied_migrations where version='0000000013'",
      )).resolves.toMatchObject({ rowCount: 1, rows: [{ version: "0000000013" }] });
      await expect(verification.query(
        "select version from ai_crm_migrations.applied_migrations where version='0000000014'",
      )).resolves.toMatchObject({ rowCount: 0, rows: [] });
      await verification.query(
        "create role ai_crm_worker_runtime login nosuperuser nocreatedb nocreaterole noreplication nobypassrls",
      );
    } finally {
      await verification.end();
    }

    await expect(runMigrations(connectionString, directories)).resolves.toBeUndefined();
    const finalVerification = new Pool({ connectionString, max: 1 });
    try {
      await expect(finalVerification.query(
        "select version from ai_crm_migrations.applied_migrations where version='0000000014'",
      )).resolves.toMatchObject({ rowCount: 1, rows: [{ version: "0000000014" }] });
    } finally {
      await finalVerification.end();
    }
  });
});
