import { rootCertificates } from "node:tls";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SecretFileSystem } from "@ai-crm/config";
import { approvedWorkerMigrationRoots, loadProductionWorkerConfiguration, validateWorkerMigrationRootManifest } from "./production-config.js";
import type { RabbitSecretFileAccess } from "./rabbit-config.js";

const secretPath = (name: string) => resolve(import.meta.dirname, "__synthetic-secrets__", name);
const postgresPath = secretPath("worker-postgres-url");
const rabbitPaths = {
  ca: secretPath("rabbit-ca"),
  consumerPassword: secretPath("rabbit-consumer-password"),
  consumerUsername: secretPath("rabbit-consumer-username"),
  publisherPassword: secretPath("rabbit-publisher-password"),
  publisherUsername: secretPath("rabbit-publisher-username"),
} as const;
const rabbitValues: Readonly<Record<string, Buffer>> = {
  [rabbitPaths.ca]: Buffer.from(rootCertificates[0] ?? ""),
  [rabbitPaths.consumerPassword]: Buffer.from("consumer-password"),
  [rabbitPaths.consumerUsername]: Buffer.from("worker-consumer"),
  [rabbitPaths.publisherPassword]: Buffer.from("publisher-password"),
  [rabbitPaths.publisherUsername]: Buffer.from("worker-publisher"),
};

const rabbitFiles: RabbitSecretFileAccess = {
  access: (path) => path in rabbitValues ? Promise.resolve() : Promise.reject(new Error("missing")),
  readFile: (path) => path in rabbitValues ? Promise.resolve(rabbitValues[path] as Buffer) : Promise.reject(new Error("missing")),
  stat: (path) => Promise.resolve({ isFile: () => path in rabbitValues, mode: 0o100400, uid: 0 }),
};

const databaseFiles: SecretFileSystem = {
  inspect: (path) => Promise.resolve({ isFile: path === postgresPath, isSymbolicLink: false, mode: 0o400, size: 43 }),
  read: (path) => path === postgresPath
    ? Promise.resolve("postgresql://worker:secret@db.internal/ai_crm")
    : Promise.reject(new Error("missing")),
};

const environment = (): NodeJS.ProcessEnv => ({
  AI_CRM_MIGRATIONS_ROOT: resolve(import.meta.dirname, "../../.."),
  AI_CRM_POSTGRES_URL_FILE: postgresPath,
  AI_CRM_WORKER_OUTBOX_BACKOFF_SECONDS: "5,30",
  AI_CRM_WORKER_OUTBOX_BATCH_SIZE: "10",
  AI_CRM_WORKER_OUTBOX_CLAIM_LEASE_SECONDS: "60",
  AI_CRM_WORKER_OUTBOX_INTERVAL_MS: "1000",
  AI_CRM_WORKER_OUTBOX_MAX_ATTEMPTS: "3",
  AI_CRM_RABBIT_CA_FILE: rabbitPaths.ca,
  AI_CRM_RABBIT_CONSUMER_PASSWORD_FILE: rabbitPaths.consumerPassword,
  AI_CRM_RABBIT_CONSUMER_USERNAME_FILE: rabbitPaths.consumerUsername,
  AI_CRM_RABBIT_HEARTBEAT_SECONDS: "30",
  AI_CRM_RABBIT_HOST: "rabbit.internal",
  AI_CRM_RABBIT_PORT: "5671",
  AI_CRM_RABBIT_PUBLISHER_PASSWORD_FILE: rabbitPaths.publisherPassword,
  AI_CRM_RABBIT_PUBLISHER_USERNAME_FILE: rabbitPaths.publisherUsername,
  AI_CRM_RABBIT_SERVERNAME: "rabbit.internal",
  AI_CRM_RABBIT_TLS: "true",
  AI_CRM_RABBIT_VHOST: "ai-crm-production",
  AI_CRM_WORKER_SCHEMA_VERSION: "0.0.0",
  AI_CRM_WORKER_TASK_PROJECTION_CONSUMER_ENABLED: "true",
  NODE_ENV: "production",
});

describe("Worker production configuration", () => {
  it("fails the bidirectional migration-root gate for either an added or removed root", () => {
    expect(() => { validateWorkerMigrationRootManifest(approvedWorkerMigrationRoots); }).not.toThrow();
    expect(() => { validateWorkerMigrationRootManifest(approvedWorkerMigrationRoots.slice(1)); }).toThrow("worker_migration_root_manifest_mismatch");
    expect(() => { validateWorkerMigrationRootManifest([...approvedWorkerMigrationRoots, "packages/platform-modules/new-capability/migrations"]); })
      .toThrow("worker_migration_root_manifest_mismatch");
  });

  it("loads a file-backed PostgreSQL URL, both least-privilege Rabbit accounts, and the complete migration catalog", async () => {
    const value = await loadProductionWorkerConfiguration({
      env: environment(),
      rabbitSecretFiles: rabbitFiles,
      secretFilePolicy: { fileSystem: databaseFiles },
    });
    expect(value.database).toMatchObject({ applicationName: "ai_crm_worker", maxConnections: 5 });
    expect(value.database.connectionString).toContain("db.internal/ai_crm");
    expect(value.rabbit.publisher.username).toBe("worker-publisher");
    expect(value.rabbit.consumer.username).toBe("worker-consumer");
    expect(value.migrations).toHaveLength(11);
    expect(value.outbox).toEqual({ backoffSeconds: [5, 30], batchSize: 10, claimLeaseSeconds: 60, intervalMs: 1000, maxAttempts: 3 });
    expect(value.migrations.some((path) => path.endsWith(join("platform-modules", "authorization", "migrations")))).toBe(true);
  });

  it("rejects an Outbox retry vector that does not match the required release policy", async () => {
    await expect(loadProductionWorkerConfiguration({
      env: { ...environment(), AI_CRM_WORKER_OUTBOX_BACKOFF_SECONDS: "5", AI_CRM_WORKER_OUTBOX_MAX_ATTEMPTS: "3" },
      rabbitSecretFiles: rabbitFiles,
      secretFilePolicy: { fileSystem: databaseFiles },
    })).rejects.toThrow("worker_outbox_policy_invalid");
  });

  it("rejects plaintext PostgreSQL values and an unsafe health window", async () => {
    const env = { ...environment(), AI_CRM_POSTGRES_URL: "postgresql://forbidden", AI_CRM_POSTGRES_URL_FILE: undefined };
    await expect(loadProductionWorkerConfiguration({ env, rabbitSecretFiles: rabbitFiles, secretFilePolicy: { fileSystem: databaseFiles } }))
      .rejects.toThrow();
    await expect(loadProductionWorkerConfiguration({
      env: { ...environment(), AI_CRM_WORKER_POSTGRES_HEALTH_INTERVAL_MS: "1000", AI_CRM_WORKER_POSTGRES_HEALTH_TIMEOUT_MS: "1000" },
      rabbitSecretFiles: rabbitFiles,
      secretFilePolicy: { fileSystem: databaseFiles },
    })).rejects.toThrow("worker_database_health_window_invalid");
  });
});
