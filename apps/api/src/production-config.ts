import { isAbsolute, resolve } from "node:path";

import { configuration, loadConfiguration, type LoadConfigurationOptions } from "@ai-crm/config";

import { loadPcBffConfiguration, type PcBffConfiguration } from "./auth/config.js";

const schema = {
  applicationSchemaVersion: configuration.string("AI_CRM_API_SCHEMA_VERSION", {
    maxLength: 64,
    pattern: /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u,
  }),
  databaseConnectionString: configuration.secretFile("AI_CRM_POSTGRES_URL_FILE"),
  databaseConnectionTimeoutMs: configuration.integer("AI_CRM_POSTGRES_CONNECT_TIMEOUT_MS", {
    default: 5_000, maximum: 60_000, minimum: 100,
  }),
  databaseIdleTimeoutMs: configuration.integer("AI_CRM_POSTGRES_IDLE_TIMEOUT_MS", {
    default: 30_000, maximum: 300_000, minimum: 1_000,
  }),
  databaseHealthProbeIntervalMs: configuration.integer("AI_CRM_API_POSTGRES_HEALTH_INTERVAL_MS", {
    default: 10_000, maximum: 60_000, minimum: 1_000,
  }),
  databaseHealthProbeTimeoutMs: configuration.integer("AI_CRM_API_POSTGRES_HEALTH_TIMEOUT_MS", {
    default: 2_000, maximum: 30_000, minimum: 100,
  }),
  databaseMaxConnections: configuration.integer("AI_CRM_API_POSTGRES_MAX_CONNECTIONS", {
    default: 10, maximum: 100, minimum: 1,
  }),
  databaseStatementTimeoutMs: configuration.integer("AI_CRM_POSTGRES_STATEMENT_TIMEOUT_MS", {
    default: 15_000, maximum: 300_000, minimum: 100,
  }),
  jwksCacheMaxAgeMs: configuration.integer("AI_CRM_OIDC_JWKS_CACHE_MAX_AGE_MS", {
    default: 3_600_000, maximum: 86_400_000, minimum: 1_000,
  }),
  jwksCooldownMs: configuration.integer("AI_CRM_OIDC_JWKS_COOLDOWN_MS", {
    default: 30_000, maximum: 3_600_000, minimum: 1_000,
  }),
  jwksUri: configuration.url("AI_CRM_KEYCLOAK_JWKS_URI", { protocols: ["https:", "http:"] }),
  migrationsRoot: configuration.string("AI_CRM_MIGRATIONS_ROOT", { maxLength: 512 }),
  oidcClockToleranceSeconds: configuration.integer("AI_CRM_OIDC_CLOCK_TOLERANCE_SECONDS", {
    default: 30, maximum: 300, minimum: 1,
  }),
} as const;

export interface ProductionApiConfiguration {
  readonly applicationSchemaVersion: string;
  readonly database: Readonly<{
    readonly applicationName: string;
    readonly connectionString: string;
    readonly connectionTimeoutMs: number;
    readonly idleTimeoutMs: number;
    readonly maxConnections: number;
    readonly statementTimeoutMs: number;
  }>;
  readonly databaseHealthProbe: Readonly<{
    readonly intervalMs: number;
    readonly timeoutMs: number;
  }>;
  readonly migrations: readonly string[];
  readonly oidcVerifier: Readonly<{
    readonly audience: string;
    readonly clientId: string;
    readonly clockToleranceSeconds: number;
    readonly issuer: string;
    readonly jwksCacheMaxAgeMs: number;
    readonly jwksCooldownMs: number;
    readonly jwksTimeoutMs: number;
    readonly jwksUri: string;
  }>;
  readonly pcBff: Readonly<PcBffConfiguration>;
}

const migrationDirectories = [
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
] as const;

export async function loadProductionApiConfiguration(
  options: LoadConfigurationOptions = {},
): Promise<Readonly<ProductionApiConfiguration>> {
  const [raw, pcBff] = await Promise.all([
    loadConfiguration(schema, options),
    loadPcBffConfiguration(options),
  ]);
  if (!isAbsolute(raw.migrationsRoot)) throw new Error("api_migrations_root_invalid");
  if (raw.databaseHealthProbeTimeoutMs >= raw.databaseHealthProbeIntervalMs) {
    throw new Error("api_database_health_window_invalid");
  }
  return Object.freeze({
    applicationSchemaVersion: raw.applicationSchemaVersion,
    database: Object.freeze({
      applicationName: "ai_crm_api",
      connectionString: raw.databaseConnectionString,
      connectionTimeoutMs: raw.databaseConnectionTimeoutMs,
      idleTimeoutMs: raw.databaseIdleTimeoutMs,
      maxConnections: raw.databaseMaxConnections,
      statementTimeoutMs: raw.databaseStatementTimeoutMs,
    }),
    databaseHealthProbe: Object.freeze({
      intervalMs: raw.databaseHealthProbeIntervalMs,
      timeoutMs: raw.databaseHealthProbeTimeoutMs,
    }),
    migrations: Object.freeze(migrationDirectories.map((directory) => resolve(raw.migrationsRoot, directory))),
    oidcVerifier: Object.freeze({
      audience: pcBff.keycloakAudience,
      clientId: pcBff.keycloakClientId,
      clockToleranceSeconds: raw.oidcClockToleranceSeconds,
      issuer: pcBff.keycloakIssuer,
      jwksCacheMaxAgeMs: raw.jwksCacheMaxAgeMs,
      jwksCooldownMs: raw.jwksCooldownMs,
      jwksTimeoutMs: pcBff.oidcTimeoutSeconds * 1_000,
      jwksUri: raw.jwksUri,
    }),
    pcBff,
  });
}
