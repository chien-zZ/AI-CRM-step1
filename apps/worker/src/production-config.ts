import { access, readdir } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { configuration, loadConfiguration, type LoadConfigurationOptions } from "@ai-crm/config";
import { loadRabbitConnectionConfiguration, type RabbitConnectionConfiguration, type RabbitSecretFileAccess } from "./rabbit-config.js";

const schema = {
  applicationSchemaVersion: configuration.string("AI_CRM_WORKER_SCHEMA_VERSION", {
    maxLength: 64,
    pattern: /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u,
  }),
  databaseCompatibilityTimeoutMs: configuration.integer("AI_CRM_WORKER_POSTGRES_COMPATIBILITY_TIMEOUT_MS", {
    default: 30_000, maximum: 300_000, minimum: 100,
  }),
  databaseConnectionString: configuration.secretFile("AI_CRM_POSTGRES_URL_FILE"),
  databaseConnectionTimeoutMs: configuration.integer("AI_CRM_POSTGRES_CONNECT_TIMEOUT_MS", {
    default: 5_000, maximum: 60_000, minimum: 100,
  }),
  databaseHealthProbeIntervalMs: configuration.integer("AI_CRM_WORKER_POSTGRES_HEALTH_INTERVAL_MS", {
    default: 10_000, maximum: 60_000, minimum: 1_000,
  }),
  databaseHealthProbeTimeoutMs: configuration.integer("AI_CRM_WORKER_POSTGRES_HEALTH_TIMEOUT_MS", {
    default: 2_000, maximum: 30_000, minimum: 100,
  }),
  databaseIdleTimeoutMs: configuration.integer("AI_CRM_POSTGRES_IDLE_TIMEOUT_MS", {
    default: 30_000, maximum: 300_000, minimum: 1_000,
  }),
  databaseMaxConnections: configuration.integer("AI_CRM_WORKER_POSTGRES_MAX_CONNECTIONS", {
    default: 5, maximum: 100, minimum: 1,
  }),
  databaseStatementTimeoutMs: configuration.integer("AI_CRM_POSTGRES_STATEMENT_TIMEOUT_MS", {
    default: 15_000, maximum: 300_000, minimum: 100,
  }),
  migrationsRoot: configuration.string("AI_CRM_MIGRATIONS_ROOT", { maxLength: 512 }),
  outboxBackoffSeconds: configuration.string("AI_CRM_WORKER_OUTBOX_BACKOFF_SECONDS", { maxLength: 128, pattern: /^(?:none|[1-9]\d*(?:,[1-9]\d*)*)$/u }),
  outboxBatchSize: configuration.integer("AI_CRM_WORKER_OUTBOX_BATCH_SIZE", { maximum: 1000, minimum: 1 }),
  outboxClaimLeaseSeconds: configuration.integer("AI_CRM_WORKER_OUTBOX_CLAIM_LEASE_SECONDS", { maximum: 86_400, minimum: 1 }),
  outboxIntervalMs: configuration.integer("AI_CRM_WORKER_OUTBOX_INTERVAL_MS", { maximum: 300_000, minimum: 10 }),
  outboxMaxAttempts: configuration.integer("AI_CRM_WORKER_OUTBOX_MAX_ATTEMPTS", { maximum: 16, minimum: 1 }),
  rabbitAcquisitionTimeoutMs: configuration.integer("AI_CRM_WORKER_RABBIT_ACQUIRE_TIMEOUT_MS", {
    default: 10_000, maximum: 60_000, minimum: 100,
  }),
  taskProjectionConsumerEnabled: configuration.boolean("AI_CRM_WORKER_TASK_PROJECTION_CONSUMER_ENABLED"),
} as const;

export const approvedWorkerMigrationRoots = Object.freeze([
  "packages/database/migrations",
  "packages/platform-modules/app-registry/migrations",
  "packages/platform-modules/audit/migrations",
  "packages/platform-modules/authorization/migrations",
  "packages/platform-modules/business-configuration/migrations",
  "packages/platform-modules/eventing-outbox/migrations",
  "packages/platform-modules/file-center/migrations",
  "packages/platform-modules/form-schema/migrations",
  "packages/platform-modules/notifications/migrations",
  "packages/platform-modules/organization/migrations",
  "packages/platform-modules/task-center/migrations",
] as const);

function normalized(values: readonly string[]): readonly string[] {
  return [...values].map((value) => value.replaceAll("\\", "/")).sort();
}

export function validateWorkerMigrationRootManifest(discovered: readonly string[]): void {
  const expected = normalized(approvedWorkerMigrationRoots);
  const actual = normalized(discovered);
  if (expected.length !== actual.length || expected.some((value, index) => value !== actual[index])) {
    throw new Error("worker_migration_root_manifest_mismatch");
  }
}

async function discoverMigrationRoots(root: string): Promise<readonly string[]> {
  const discovered: string[] = [];
  try {
    await access(resolve(root, "packages/database/migrations"));
    discovered.push("packages/database/migrations");
    const platformRoot = resolve(root, "packages/platform-modules");
    const modules = await readdir(platformRoot, { withFileTypes: true });
    await Promise.all(modules.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const relative = `packages/platform-modules/${entry.name}/migrations`;
      try {
        await access(resolve(root, relative));
        discovered.push(relative);
      } catch { /* A platform module without migrations is not a migration root. */ }
    }));
  } catch {
    throw new Error("worker_migration_root_manifest_mismatch");
  }
  return discovered;
}

export interface ProductionWorkerConfiguration {
  readonly applicationSchemaVersion: string;
  readonly database: Readonly<{
    readonly applicationName: string;
    readonly connectionString: string;
    readonly connectionTimeoutMs: number;
    readonly idleTimeoutMs: number;
    readonly maxConnections: number;
    readonly statementTimeoutMs: number;
  }>;
  readonly databaseCompatibilityTimeoutMs: number;
  readonly databaseHealthProbe: Readonly<{ readonly intervalMs: number; readonly timeoutMs: number }>;
  readonly migrations: readonly string[];
  readonly outbox: Readonly<{
    readonly backoffSeconds: readonly number[];
    readonly batchSize: number;
    readonly claimLeaseSeconds: number;
    readonly intervalMs: number;
    readonly maxAttempts: number;
  }>;
  readonly rabbit: Readonly<{
    readonly acquisitionTimeoutMs: number;
    readonly consumer: Readonly<RabbitConnectionConfiguration>;
    readonly publisher: Readonly<RabbitConnectionConfiguration>;
  }>;
  readonly taskProjectionConsumerEnabled: boolean;
}

export interface LoadProductionWorkerConfigurationOptions extends LoadConfigurationOptions {
  readonly rabbitSecretFiles?: RabbitSecretFileAccess;
}

export async function loadProductionWorkerConfiguration(
  options: LoadProductionWorkerConfigurationOptions = {},
): Promise<Readonly<ProductionWorkerConfiguration>> {
  const raw = await loadConfiguration(schema, options);
  if (!isAbsolute(raw.migrationsRoot)) throw new Error("worker_migrations_root_invalid");
  if (raw.databaseHealthProbeTimeoutMs >= raw.databaseHealthProbeIntervalMs) {
    throw new Error("worker_database_health_window_invalid");
  }
  validateWorkerMigrationRootManifest(await discoverMigrationRoots(raw.migrationsRoot));
  const source = options.env ?? process.env;
  const [consumer, publisher] = await Promise.all([
    loadRabbitConnectionConfiguration("consumer", source, options.rabbitSecretFiles),
    loadRabbitConnectionConfiguration("publisher", source, options.rabbitSecretFiles),
  ]);
  const outboxBackoffSeconds = raw.outboxBackoffSeconds === "none" ? [] : raw.outboxBackoffSeconds.split(",").map(Number);
  if (outboxBackoffSeconds.length !== raw.outboxMaxAttempts - 1 || outboxBackoffSeconds.some((value) => !Number.isSafeInteger(value) || value > 86_400)) {
    throw new Error("worker_outbox_policy_invalid");
  }
  return Object.freeze({
    applicationSchemaVersion: raw.applicationSchemaVersion,
    database: Object.freeze({
      applicationName: "ai_crm_worker",
      connectionString: raw.databaseConnectionString,
      connectionTimeoutMs: raw.databaseConnectionTimeoutMs,
      idleTimeoutMs: raw.databaseIdleTimeoutMs,
      maxConnections: raw.databaseMaxConnections,
      statementTimeoutMs: raw.databaseStatementTimeoutMs,
    }),
    databaseCompatibilityTimeoutMs: raw.databaseCompatibilityTimeoutMs,
    databaseHealthProbe: Object.freeze({
      intervalMs: raw.databaseHealthProbeIntervalMs,
      timeoutMs: raw.databaseHealthProbeTimeoutMs,
    }),
    migrations: Object.freeze(approvedWorkerMigrationRoots.map((directory) => resolve(raw.migrationsRoot, directory))),
    outbox: Object.freeze({
      backoffSeconds: Object.freeze(outboxBackoffSeconds),
      batchSize: raw.outboxBatchSize,
      claimLeaseSeconds: raw.outboxClaimLeaseSeconds,
      intervalMs: raw.outboxIntervalMs,
      maxAttempts: raw.outboxMaxAttempts,
    }),
    rabbit: Object.freeze({ acquisitionTimeoutMs: raw.rabbitAcquisitionTimeoutMs, consumer, publisher }),
    taskProjectionConsumerEnabled: raw.taskProjectionConsumerEnabled,
  });
}
