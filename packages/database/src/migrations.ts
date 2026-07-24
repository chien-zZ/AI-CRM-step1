import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

const migrationName = /^(\d{10})_([a-z0-9_]+)\.sql$/;
const advisoryLock = 1_904_202_607;

export interface MigrationMetadata {
  readonly applicationCompatibility: string;
  readonly destructive: boolean;
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
    const metadata = JSON.parse(await readFile(resolve(directory, name.replace(/\.sql$/, ".meta.json")), "utf8")) as MigrationMetadata;
    if (!metadata.moduleOwner || !metadata.purpose || !metadata.applicationCompatibility || !metadata.recovery) {
      throw new Error(`Migration ${name} has incomplete review metadata.`);
    }
    if (!metadata.destructive && /\b(drop|truncate)\b/i.test(sql)) {
      throw new Error(`Migration ${name} contains destructive SQL without approval metadata.`);
    }
    migrations.push({ checksum: createHash("sha256").update(sql).digest("hex"), metadata, name, sql, version: match[1] });
  }
  if (new Set(migrations.map((item) => item.version)).size !== migrations.length) throw new Error("Migration versions must be unique.");
  return migrations;
}

export async function runMigrationsWithPool(pool: MigrationPool, directory: string): Promise<void> {
  const migrations = await loadMigrations(directory);
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
        await client.query(
          "insert into ai_crm_migrations.applied_migrations (version, name, module_owner, checksum) values ($1, $2, $3, $4)",
          [migration.version, migration.name, migration.metadata.moduleOwner, migration.checksum],
        );
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

export async function runMigrations(connectionString: string, directory: string): Promise<void> {
  const pool = new Pool({ application_name: "ai_crm_migration", connectionString, max: 1 });
  try {
    await runMigrationsWithPool(pool as unknown as MigrationPool, directory);
  } finally {
    await pool.end();
  }
}
