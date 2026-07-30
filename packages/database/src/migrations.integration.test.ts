import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { checkMigrationCompatibility } from "./migration-compatibility.js";
import { runMigrations } from "./migrations.js";

const urlFile = process.env.TEST_DATABASE_MIGRATION_URL_FILE;

describe.skipIf(!urlFile)("PostgreSQL migration integration", () => {
  it("upgrades an empty database and remains idempotent", async () => {
    if (!urlFile) throw new Error("TEST_DATABASE_MIGRATION_URL_FILE is required for this integration test.");
    const connectionString = (await readFile(resolve(urlFile), "utf8")).trim();
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
    await runMigrations(connectionString, directories);
    await runMigrations(connectionString, directories);

    const pool = new Pool({ connectionString, connectionTimeoutMillis: 5_000, max: 1, query_timeout: 5_000, statement_timeout: 5_000 });
    try {
      const compatibility = await checkMigrationCompatibility(pool, directories, "0.0.0");
      expect(compatibility).toEqual({
        applicationSchemaVersion: "0.0.0",
        compatible: true,
        currentMigrationVersion: "0000000015",
        issues: [],
      });
      const result = await pool.query<{ count: string }>("select count(*)::text as count from ai_crm_migrations.applied_migrations");
      expect(result.rows[0]?.count).toBe("15");
    } finally {
      await pool.end();
    }
  });
});
