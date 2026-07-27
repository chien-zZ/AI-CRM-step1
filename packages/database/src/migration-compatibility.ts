import { loadMigrations, type ApplicationCompatibility, type MigrationDefinition, type MigrationPool } from "./migrations.js";

export type MigrationCompatibilityIssue =
  | { readonly kind: "application-schema-version-unsupported"; readonly migrationVersion: string }
  | { readonly kind: "checksum-mismatch"; readonly migrationVersion: string }
  | { readonly kind: "compatibility-evidence-mismatch"; readonly migrationVersion: string }
  | { readonly kind: "compatibility-evidence-unavailable"; readonly migrationVersion: string }
  | { readonly kind: "missing-migration"; readonly migrationVersion: string }
  | { readonly kind: "record-mismatch"; readonly migrationVersion: string }
  | { readonly kind: "unknown-applied-migration"; readonly migrationVersion: string };

export interface MigrationCompatibilityReport {
  readonly applicationSchemaVersion: string;
  readonly compatible: boolean;
  readonly currentMigrationVersion: string | null;
  readonly issues: readonly MigrationCompatibilityIssue[];
}

interface AppliedMigrationRow {
  readonly application_compatibility_maximum_exclusive: string | null;
  readonly application_compatibility_minimum_inclusive: string | null;
  readonly checksum: string;
  readonly module_owner: string;
  readonly name: string;
  readonly version: string;
}

interface SemanticVersion {
  readonly major: bigint;
  readonly minor: bigint;
  readonly patch: bigint;
}

function parseSemanticVersion(value: string): SemanticVersion {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error("Application schema version must use the x.y.z format without prerelease or build metadata.");
  }
  return { major: BigInt(match[1]), minor: BigInt(match[2]), patch: BigInt(match[3]) };
}

function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion): number {
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  return 0;
}

function supportsApplicationSchemaVersion(compatibility: ApplicationCompatibility, applicationSchemaVersion: SemanticVersion): boolean {
  const minimum = parseSemanticVersion(compatibility.minimumInclusive);
  if (compareSemanticVersions(applicationSchemaVersion, minimum) < 0) return false;
  if (compatibility.maximumExclusive === undefined) return true;
  return compareSemanticVersions(applicationSchemaVersion, parseSemanticVersion(compatibility.maximumExclusive)) < 0;
}

async function loadMigrationCatalog(directories: string | readonly string[]): Promise<MigrationDefinition[]> {
  const values = typeof directories === "string" ? [directories] : directories;
  const migrations = (await Promise.all(values.map(loadMigrations))).flat()
    .sort((left, right) => left.version.localeCompare(right.version) || left.name.localeCompare(right.name));
  if (new Set(migrations.map(({ version }) => version)).size !== migrations.length) {
    throw new Error("Migration versions must be globally unique across migration directories.");
  }
  return migrations;
}

export async function checkMigrationCompatibility(
  pool: MigrationPool,
  directories: string | readonly string[],
  applicationSchemaVersion: string,
): Promise<MigrationCompatibilityReport> {
  const parsedApplicationSchemaVersion = parseSemanticVersion(applicationSchemaVersion);
  const migrations = await loadMigrationCatalog(directories);
  const expectedByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  const client = await pool.connect();
  try {
    const result = await client.query<AppliedMigrationRow>(
      "select version, name, module_owner, checksum, application_compatibility_minimum_inclusive, application_compatibility_maximum_exclusive from ai_crm_migrations.applied_migrations order by version",
    );
    const appliedByVersion = new Map(result.rows.map((row) => [row.version, row]));
    const issues: MigrationCompatibilityIssue[] = [];

    for (const migration of migrations) {
      const applied = appliedByVersion.get(migration.version);
      if (!applied) {
        issues.push({ kind: "missing-migration", migrationVersion: migration.version });
        continue;
      }
      if (applied.checksum !== migration.checksum) {
        issues.push({ kind: "checksum-mismatch", migrationVersion: migration.version });
      }
      if (applied.name !== migration.name || applied.module_owner !== migration.metadata.moduleOwner) {
        issues.push({ kind: "record-mismatch", migrationVersion: migration.version });
      }
      if (applied.application_compatibility_minimum_inclusive === null) {
        issues.push({ kind: "compatibility-evidence-unavailable", migrationVersion: migration.version });
      } else {
        const evidence: ApplicationCompatibility = {
          ...(applied.application_compatibility_maximum_exclusive === null
            ? {}
            : { maximumExclusive: applied.application_compatibility_maximum_exclusive }),
          minimumInclusive: applied.application_compatibility_minimum_inclusive,
        };
        if (evidence.minimumInclusive !== migration.metadata.applicationCompatibilityRange.minimumInclusive
          || evidence.maximumExclusive !== migration.metadata.applicationCompatibilityRange.maximumExclusive) {
          issues.push({ kind: "compatibility-evidence-mismatch", migrationVersion: migration.version });
        } else if (!supportsApplicationSchemaVersion(evidence, parsedApplicationSchemaVersion)) {
          issues.push({ kind: "application-schema-version-unsupported", migrationVersion: migration.version });
        }
      }
    }
    for (const applied of result.rows) {
      if (!expectedByVersion.has(applied.version)) {
        issues.push({ kind: "unknown-applied-migration", migrationVersion: applied.version });
      }
    }

    return {
      applicationSchemaVersion,
      compatible: issues.length === 0,
      currentMigrationVersion: result.rows.at(-1)?.version ?? null,
      issues,
    };
  } finally {
    client.release();
  }
}
