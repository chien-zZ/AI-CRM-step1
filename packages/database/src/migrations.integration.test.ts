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
    const directory = resolve(import.meta.dirname, "../migrations");
    await runMigrations(connectionString, directory);
    await runMigrations(connectionString, directory);

    const compatibility = await checkMigrationCompatibility(connectionString, directory, "0.0.0");
    expect(compatibility).toEqual({
      applicationSchemaVersion: "0.0.0",
      compatible: true,
      currentMigrationVersion: "0000000001",
      issues: [],
    });

    const pool = new Pool({ connectionString, max: 1 });
    try {
      const result = await pool.query<{ count: string }>("select count(*)::text as count from ai_crm_migrations.applied_migrations");
      expect(result.rows[0]?.count).toBe("1");
    } finally {
      await pool.end();
    }
  });
});
