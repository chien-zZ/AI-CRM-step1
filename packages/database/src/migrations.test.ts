import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMigrations, runMigrationsWithPool, type MigrationConnection, type MigrationPool } from "./migrations.js";

const temporaryDirectories: string[] = [];

async function migrationDirectory(sql: string, metadataOverrides: Record<string, unknown> = {}, version = "0000000001"): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "ai-crm-migrations-"));
  temporaryDirectories.push(directory);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, `${version}_foundation.sql`), sql);
  await writeFile(resolve(directory, `${version}_foundation.meta.json`), JSON.stringify({
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
  it("normalizes canonical application compatibility metadata", async () => {
    const directory = await migrationDirectory("select 1;", {
      applicationCompatibility: { maximumExclusive: "2.0.0", minimumInclusive: "1.2.3" },
    });
    const migrations = await loadMigrations(directory);
    expect(migrations[0]?.metadata.applicationCompatibility).toBe(">=1.2.3 <2.0.0");
    expect(migrations[0]?.metadata.applicationCompatibilityRange).toEqual({ maximumExclusive: "2.0.0", minimumInclusive: "1.2.3" });
  });

  it("adapts the historical machine-readable compatibility range", async () => {
    const directory = await migrationDirectory("select 1;");
    const migrations = await loadMigrations(directory);
    expect(migrations[0]?.metadata.applicationCompatibility).toBe(">=0.0.0");
    expect(migrations[0]?.metadata.applicationCompatibilityRange).toEqual({ minimumInclusive: "0.0.0" });
  });

  it("compares compatibility components without Number precision loss", async () => {
    const directory = await migrationDirectory("select 1;", {
      applicationCompatibility: {
        maximumExclusive: "90071992547409931234567891.0.0",
        minimumInclusive: "90071992547409931234567890.0.0",
      },
    });
    await expect(loadMigrations(directory)).resolves.toHaveLength(1);
  });

  it("rejects new free-text and empty compatibility ranges", async () => {
    const prose = await migrationDirectory("select 1;", { applicationCompatibility: "Works with the current release." });
    const empty = await migrationDirectory(
      "select 1;",
      { applicationCompatibility: { maximumExclusive: "1.0.0", minimumInclusive: "1.0.0" } },
      "0000000002",
    );
    await expect(loadMigrations(prose)).rejects.toThrow("invalid applicationCompatibility");
    await expect(loadMigrations(empty)).rejects.toThrow("range is empty");
  });

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

  it("persists normalized compatibility evidence for registry version 11 and later", async () => {
    const directory = await migrationDirectory(
      "select evidence;",
      { applicationCompatibility: { maximumExclusive: "3.0.0", minimumInclusive: "2.0.0" } },
      "0000000011",
    );
    const calls: { readonly sql: string; readonly values?: readonly unknown[] }[] = [];
    const connection: MigrationConnection = {
      query<Row>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[] }> {
        calls.push({ sql, ...(values === undefined ? {} : { values }) });
        if (sql.startsWith("select version")) {
          const error = new Error("missing") as Error & { code: string };
          error.code = "42P01";
          return Promise.reject(error);
        }
        return Promise.resolve({ rows: [] as Row[] });
      },
      release() {},
    };
    const pool: MigrationPool = { connect: () => Promise.resolve(connection), end: () => Promise.resolve() };
    await runMigrationsWithPool(pool, directory);
    const insert = calls.find(({ sql }) => sql.startsWith("insert into"));
    expect(insert?.sql).toContain("application_compatibility_minimum_inclusive");
    expect(insert?.values?.slice(-2)).toEqual(["2.0.0", "3.0.0"]);
  });

  it("orders globally versioned migrations across module directories",async()=>{
    const later=await migrationDirectory("select later;",{},"0000000003");const earlier=await migrationDirectory("select earlier;",{},"0000000002");const statements:string[]=[];
    const connection:MigrationConnection={query<Row>(sql:string):Promise<{rows:Row[]}>{statements.push(sql);if(sql.startsWith("select version")){const error=new Error("missing") as Error&{code:string};error.code="42P01";return Promise.reject(error);}return Promise.resolve({rows:[] as Row[]});},release(){}};
    const pool:MigrationPool={connect:()=>Promise.resolve(connection),end:()=>Promise.resolve()};await runMigrationsWithPool(pool,[later,earlier]);
    expect(statements.indexOf("select earlier;")).toBeLessThan(statements.indexOf("select later;"));
  });
});
