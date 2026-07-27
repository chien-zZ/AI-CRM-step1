import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

const migrationName = /^(\d{10})_([a-z0-9_]+)\.sql$/;
const advisoryLock = 1_904_202_607;

export interface ApplicationCompatibility {
  readonly maximumExclusive?: string;
  readonly minimumInclusive: string;
}

export interface MigrationMetadata {
  /** Legacy string representation retained for source compatibility; do not use for runtime compatibility decisions. */
  readonly applicationCompatibility: string;
  readonly applicationCompatibilityRange: ApplicationCompatibility;
  readonly backfill: string;
  readonly dataImpact: string;
  readonly destructive: boolean;
  readonly destructiveApproval?: string;
  readonly forwardFix: string;
  readonly lockImpact: string;
  readonly moduleOwner: string;
  readonly purpose: string;
  readonly recovery: string;
}

export interface MigrationDefinition {
  readonly checksum: string;
  readonly metadata: MigrationMetadata;
  readonly name: string;
  readonly sql: string;
  readonly version: string;
}

interface QueryResultLike<Row = Record<string, unknown>> {
  readonly rows: Row[];
}

interface RawMigrationMetadata extends Omit<MigrationMetadata, "applicationCompatibility" | "applicationCompatibilityRange"> {
  readonly applicationCompatibility: unknown;
}

const legacyAdditiveCompatibility = new Set([
  "Additive; existing applications and modules are unaffected until composition.",
  "Additive; existing applications are unaffected until Notification Center is composed.",
  "Additive; existing applications are unaffected until Task Center is composed.",
]);

interface SemanticVersion {
  readonly major: bigint;
  readonly minor: bigint;
  readonly patch: bigint;
}

function parseSemanticVersion(value: unknown, context: string): SemanticVersion {
  if (typeof value !== "string") throw new Error(`${context} must be a semantic version string.`);
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) throw new Error(`${context} must use the x.y.z format without prerelease or build metadata.`);
  return { major: BigInt(match[1]), minor: BigInt(match[2]), patch: BigInt(match[3]) };
}

function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion): number {
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  return 0;
}

function normalizeApplicationCompatibility(
  value: unknown,
  name: string,
): { readonly declaration: string; readonly range: ApplicationCompatibility } {
  if (value === ">=0.0.0" || (typeof value === "string" && legacyAdditiveCompatibility.has(value))) {
    return { declaration: value, range: { minimumInclusive: "0.0.0" } };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Migration ${name} has invalid applicationCompatibility metadata.`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "minimumInclusive" && key !== "maximumExclusive")) {
    throw new Error(`Migration ${name} has unknown applicationCompatibility fields.`);
  }
  const minimum = parseSemanticVersion(record.minimumInclusive, `Migration ${name} applicationCompatibility.minimumInclusive`);
  if (record.maximumExclusive !== undefined) {
    const maximum = parseSemanticVersion(record.maximumExclusive, `Migration ${name} applicationCompatibility.maximumExclusive`);
    if (compareSemanticVersions(minimum, maximum) >= 0) {
      throw new Error(`Migration ${name} applicationCompatibility range is empty.`);
    }
  }
  const range = {
    ...(record.maximumExclusive === undefined ? {} : { maximumExclusive: record.maximumExclusive as string }),
    minimumInclusive: record.minimumInclusive as string,
  };
  return {
    declaration: `>=${range.minimumInclusive}${range.maximumExclusive === undefined ? "" : ` <${range.maximumExclusive}`}`,
    range,
  };
}

export interface MigrationConnection {
  query<Row = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<QueryResultLike<Row>>;
  release(): void;
}

export interface MigrationPool {
  connect(): Promise<MigrationConnection>;
  end(): Promise<void>;
}

export async function loadMigrations(directory: string): Promise<MigrationDefinition[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const migrations = [];
  for (const name of names) {
    const match = migrationName.exec(name);
    if (!match?.[1]) throw new Error(`Invalid migration filename: ${name}.`);
    const sql = await readFile(resolve(directory, name), "utf8");
    const rawMetadata = JSON.parse(await readFile(resolve(directory, name.replace(/\.sql$/, ".meta.json")), "utf8")) as RawMigrationMetadata;
    const compatibility = normalizeApplicationCompatibility(rawMetadata.applicationCompatibility, name);
    const metadata: MigrationMetadata = {
      ...rawMetadata,
      applicationCompatibility: compatibility.declaration,
      applicationCompatibilityRange: compatibility.range,
    };
    const requiredText = [
      metadata.moduleOwner,
      metadata.purpose,
      metadata.applicationCompatibility,
      metadata.lockImpact,
      metadata.dataImpact,
      metadata.backfill,
      metadata.recovery,
      metadata.forwardFix,
    ];
    if (requiredText.some((value) => typeof value !== "string" || value.trim().length === 0)
      || typeof metadata.destructive !== "boolean") {
      throw new Error(`Migration ${name} has incomplete review metadata.`);
    }
    if (metadata.destructive && (!metadata.destructiveApproval || metadata.destructiveApproval.trim().length === 0)) {
      throw new Error(`Migration ${name} is destructive but has no approval metadata.`);
    }
    if (!metadata.destructive && /\b(drop|truncate)\b/i.test(sql)) {
      throw new Error(`Migration ${name} contains destructive SQL without approval metadata.`);
    }
    migrations.push({ checksum: createHash("sha256").update(sql).digest("hex"), metadata, name, sql, version: match[1] });
  }
  if (new Set(migrations.map((item) => item.version)).size !== migrations.length) throw new Error("Migration versions must be unique.");
  return migrations;
}

export async function runMigrationsWithPool(pool: MigrationPool, directory: string | readonly string[]): Promise<void> {
  const directories=typeof directory==="string"?[directory]:directory;
  const migrations=(await Promise.all(directories.map(loadMigrations))).flat().sort((left,right)=>left.version.localeCompare(right.version)||left.name.localeCompare(right.name));
  if(new Set(migrations.map(({version})=>version)).size!==migrations.length)throw new Error("Migration versions must be globally unique across migration directories.");
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [advisoryLock]);
    let applied = new Map<string, string>();
    try {
      const result = await client.query<{ version: string; checksum: string }>("select version, checksum from ai_crm_migrations.applied_migrations");
      applied = new Map(result.rows.map((row) => [row.version, row.checksum]));
    } catch (error) {
      if ((error as { code?: string }).code !== "42P01" && (error as { code?: string }).code !== "3F000") throw error;
    }

    for (const migration of migrations) {
      const checksum = applied.get(migration.version);
      if (checksum && checksum !== migration.checksum) throw new Error(`Applied migration ${migration.name} was modified.`);
      if (checksum) continue;
      await client.query("begin");
      try {
        await client.query(migration.sql);
        if (migration.version.localeCompare("0000000011") >= 0) {
          await client.query(
            "insert into ai_crm_migrations.applied_migrations (version, name, module_owner, checksum, application_compatibility_minimum_inclusive, application_compatibility_maximum_exclusive) values ($1, $2, $3, $4, $5, $6)",
            [
              migration.version,
              migration.name,
              migration.metadata.moduleOwner,
              migration.checksum,
              migration.metadata.applicationCompatibilityRange.minimumInclusive,
              migration.metadata.applicationCompatibilityRange.maximumExclusive ?? null,
            ],
          );
        } else {
          await client.query(
            "insert into ai_crm_migrations.applied_migrations (version, name, module_owner, checksum) values ($1, $2, $3, $4)",
            [migration.version, migration.name, migration.metadata.moduleOwner, migration.checksum],
          );
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock($1)", [advisoryLock]).catch(() => undefined);
    client.release();
  }
}

export async function runMigrations(connectionString: string, directory: string | readonly string[]): Promise<void> {
  const pool = new Pool({ application_name: "ai_crm_migration", connectionString, max: 1 });
  try {
    await runMigrationsWithPool(pool as unknown as MigrationPool, directory);
  } finally {
    await pool.end();
  }
}
