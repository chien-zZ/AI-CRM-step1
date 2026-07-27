import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkMigrationCompatibility } from "./migration-compatibility.js";
import type { MigrationConnection, MigrationPool } from "./migrations.js";

const temporaryDirectories: string[] = [];

async function migrationDirectory(
  version = "0000000001",
  applicationCompatibility: unknown = { minimumInclusive: "1.0.0" },
  sql = "select 1;",
): Promise<{ readonly checksum: string; readonly directory: string; readonly name: string }> {
  const directory = await mkdtemp(resolve(tmpdir(), "ai-crm-compatibility-"));
  temporaryDirectories.push(directory);
  await mkdir(directory, { recursive: true });
  const name = `${version}_foundation.sql`;
  await writeFile(resolve(directory, name), sql);
  await writeFile(resolve(directory, name.replace(".sql", ".meta.json")), JSON.stringify({
    applicationCompatibility,
    backfill: "Not required.",
    dataImpact: "No application data is affected.",
    destructive: false,
    forwardFix: "Append a later fixture migration.",
    lockImpact: "No application tables are locked.",
    moduleOwner: "database",
    purpose: "Compatibility fixture.",
    recovery: "Drop the isolated fixture database.",
  }));
  return { checksum: createHash("sha256").update(sql).digest("hex"), directory, name };
}

function poolReturning(rows: readonly Record<string, unknown>[], statements: string[]): MigrationPool {
  const connection: MigrationConnection = {
    query<Row>(sql: string): Promise<{ rows: Row[] }> {
      statements.push(sql);
      return Promise.resolve({ rows: rows as Row[] });
    },
    release() {
      statements.push("release");
    },
  };
  return { connect: () => Promise.resolve(connection), end: () => Promise.resolve() };
}

afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true }))));

describe("migration application compatibility", () => {
  it("accepts persisted compatibility evidence using one read-only query", async () => {
    const fixture = await migrationDirectory();
    const statements: string[] = [];
    const report = await checkMigrationCompatibility(poolReturning([{
      application_compatibility_maximum_exclusive: null,
      application_compatibility_minimum_inclusive: "1.0.0",
      checksum: fixture.checksum,
      module_owner: "database",
      name: fixture.name,
      version: "0000000001",
    }], statements), fixture.directory, "90071992547409931234567890.0.0");

    expect(report).toEqual({
      applicationSchemaVersion: "90071992547409931234567890.0.0",
      compatible: true,
      currentMigrationVersion: "0000000001",
      issues: [],
    });
    expect(statements).toEqual([
      "select version, name, module_owner, checksum, application_compatibility_minimum_inclusive, application_compatibility_maximum_exclusive from ai_crm_migrations.applied_migrations order by version",
      "release",
    ]);
  });

  it("reports missing, unknown, checksum, identity, and unavailable compatibility evidence", async () => {
    const first = await migrationDirectory("0000000001", { maximumExclusive: "2.0.0", minimumInclusive: "1.0.0" });
    const second = await migrationDirectory("0000000002");
    const report = await checkMigrationCompatibility(poolReturning([{
      application_compatibility_maximum_exclusive: null,
      application_compatibility_minimum_inclusive: null,
      checksum: "different",
      module_owner: "another-owner",
      name: first.name,
      version: "0000000001",
    }, {
      application_compatibility_maximum_exclusive: null,
      application_compatibility_minimum_inclusive: "0.0.0",
      checksum: "unknown",
      module_owner: "database",
      name: "0000000003_unknown.sql",
      version: "0000000003",
    }], []), [first.directory, second.directory], "2.0.0");

    expect(report.compatible).toBe(false);
    expect(report.currentMigrationVersion).toBe("0000000003");
    expect(report.issues).toEqual([
      { kind: "checksum-mismatch", migrationVersion: "0000000001" },
      { kind: "record-mismatch", migrationVersion: "0000000001" },
      { kind: "compatibility-evidence-unavailable", migrationVersion: "0000000001" },
      { kind: "missing-migration", migrationVersion: "0000000002" },
      { kind: "unknown-applied-migration", migrationVersion: "0000000003" },
    ]);
  });

  it("fails closed when mutable metadata differs from persisted evidence", async () => {
    const fixture = await migrationDirectory("0000000001", { minimumInclusive: "999.0.0" });
    const report = await checkMigrationCompatibility(poolReturning([{
      application_compatibility_maximum_exclusive: null,
      application_compatibility_minimum_inclusive: "0.0.0",
      checksum: fixture.checksum,
      module_owner: "database",
      name: fixture.name,
      version: "0000000001",
    }], []), fixture.directory, "0.0.0");
    expect(report.compatible).toBe(false);
    expect(report.issues).toEqual([{ kind: "compatibility-evidence-mismatch", migrationVersion: "0000000001" }]);
  });

  it("fails closed for canonical metadata without persisted or reviewed evidence", async () => {
    const fixture = await migrationDirectory("0000000011", { minimumInclusive: "0.0.0" });
    const report = await checkMigrationCompatibility(poolReturning([{
      application_compatibility_maximum_exclusive: null,
      application_compatibility_minimum_inclusive: null,
      checksum: fixture.checksum,
      module_owner: "database",
      name: fixture.name,
      version: "0000000011",
    }], []), fixture.directory, "1.0.0");
    expect(report.issues).toEqual([{ kind: "compatibility-evidence-unavailable", migrationVersion: "0000000011" }]);
  });

  it("rejects malformed application versions before opening a connection", async () => {
    const fixture = await migrationDirectory();
    let connected = false;
    const pool: MigrationPool = {
      connect() { connected = true; throw new Error("must not connect"); },
      end: () => Promise.resolve(),
    };
    await expect(checkMigrationCompatibility(pool, fixture.directory, "1.0")).rejects.toThrow("x.y.z");
    expect(connected).toBe(false);
  });

  it("releases the connection and propagates registry query failures", async () => {
    const fixture = await migrationDirectory();
    let released = false;
    const connection: MigrationConnection = {
      query: () => Promise.reject(new Error("registry unavailable")),
      release() { released = true; },
    };
    const pool: MigrationPool = { connect: () => Promise.resolve(connection), end: () => Promise.resolve() };
    await expect(checkMigrationCompatibility(pool, fixture.directory, "1.0.0")).rejects.toThrow("registry unavailable");
    expect(released).toBe(true);
  });
});
