import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMigrations, runMigrationsWithPool, type MigrationConnection, type MigrationPool } from "./migrations.js";

const temporaryDirectories: string[] = [];

async function migrationDirectory(sql: string, metadataOverrides: Record<string, unknown> = {}): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "ai-crm-migrations-"));
  temporaryDirectories.push(directory);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "0000000001_foundation.sql"), sql);
  await writeFile(resolve(directory, "0000000001_foundation.meta.json"), JSON.stringify({
    applicationCompatibility: ">=0.0.0",
    backfill: "Not required for this isolated fixture.",
    dataImpact: "No persisted application data is affected.",
    destructive: false,
    forwardFix: "Create a later fixture migration.",
    lockImpact: "No application tables are locked.",
    moduleOwner: "database",
    purpose: "test fixture",
    recovery: "Drop the isolated test database.",
    ...metadataOverrides,
  }));
  return directory;
}

afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true }))));

describe("migration governance", () => {
  it("rejects unapproved destructive SQL", async () => {
    const directory = await migrationDirectory("drop table unsafe;");
    await expect(loadMigrations(directory)).rejects.toThrow("destructive SQL");
  });

  it("rejects destructive migrations without explicit approval", async () => {
    const directory = await migrationDirectory("drop table unsafe;", { destructive: true });
    await expect(loadMigrations(directory)).rejects.toThrow("no approval metadata");
  });

  it("accepts an explicitly approved destructive migration", async () => {
    const directory = await migrationDirectory("drop table obsolete;", {
      destructive: true,
      destructiveApproval: "Approved in the isolated migration governance test.",
    });
    await expect(loadMigrations(directory)).resolves.toHaveLength(1);
  });

  it("rolls back a failed migration without recording success", async () => {
    const directory = await migrationDirectory("select broken;");
    const statements: string[] = [];
    const connection: MigrationConnection = {
      query<Row>(sql: string): Promise<{ rows: Row[] }> {
        statements.push(sql);
        if (sql.includes("applied_migrations") && sql.startsWith("select")) {
          const error = new Error("missing") as Error & { code: string };
          error.code = "42P01";
          return Promise.reject(error);
        }
        if (sql === "select broken;") return Promise.reject(new Error("migration failed"));
        return Promise.resolve({ rows: [] as Row[] });
      },
      release() {},
    };
    const pool: MigrationPool = {
      connect() { return Promise.resolve(connection); },
      end() { return Promise.resolve(); },
    };
    await expect(runMigrationsWithPool(pool, directory)).rejects.toThrow("migration failed");
    expect(statements).toContain("rollback");
    expect(statements.some((sql) => sql.startsWith("insert into"))).toBe(false);
  });
});
