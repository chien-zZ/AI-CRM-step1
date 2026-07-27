import { AuthorizationUnavailableError } from "@ai-crm/platform-authorization";
import { createOidcTokenVerifier, type TokenVerifier } from "@ai-crm/platform-auth-context";
import {
  checkMigrationCompatibility,
  createDatabaseRuntime,
  type DatabaseConfig,
  type DatabaseRuntime,
  type MigrationPool,
} from "@ai-crm/database";

import { BrowserSessionFailure } from "./auth/errors.js";
import { createPcAuthenticationHttpAdapter } from "./auth/http-adapter.js";
import { createOidcClient, type OidcClientPort } from "./auth/oidc.js";
import { createPcBffSessionService } from "./auth/session-service.js";
import {
  connectRedisSessionStore,
  createRedisBrowserSessionStore,
  type RedisSessionConnection,
  type RedisSessionConnectionConfig,
} from "./auth/session-store.js";
import type { AuthenticationHttpResponse } from "./auth/http-adapter.js";
import type { ApiPlatformBindings } from "./composition.js";
import {
  loadProductionApiConfiguration,
  type ProductionApiConfiguration,
} from "./production-config.js";
import type { ApiRuntimeConfiguration } from "./runtime-config.js";

export interface ApiPlatformBindingFactory {
  readonly create: (configuration: Readonly<ApiRuntimeConfiguration>, signal?: AbortSignal) => ApiPlatformBindings | Promise<ApiPlatformBindings>;
}

const unavailableAuthenticationResponse: AuthenticationHttpResponse = Object.freeze({
  body: Object.freeze({
    code: "authentication_dependency_unavailable",
    message: "Authentication is temporarily unavailable.",
  }),
  headers: Object.freeze({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }),
  status: 503,
});

function rejected<T>(): Promise<T> {
  return Promise.reject(new Error("api_synthetic_capability_unavailable"));
}

function createUnavailableBindings(): ApiPlatformBindings {
  const bindings: ApiPlatformBindings = {
    audit: { readSensitive: () => rejected(), record: () => rejected() },
    authentication: {
      beginLogin: () => Promise.resolve(unavailableAuthenticationResponse),
      completeLogin: () => Promise.resolve(unavailableAuthenticationResponse),
      currentSession: () => Promise.resolve(unavailableAuthenticationResponse),
      logout: () => Promise.resolve(unavailableAuthenticationResponse),
      refresh: () => Promise.resolve(unavailableAuthenticationResponse),
    },
    authenticationCallbackUrl: (requestPathAndQuery: string) => new URL(requestPathAndQuery, "https://api.invalid").href,
    authorization: {
      batchCheck: () => Promise.reject(new AuthorizationUnavailableError()),
      check: () => Promise.reject(new AuthorizationUnavailableError()),
      invalidatePolicyVersion: () => Promise.reject(new AuthorizationUnavailableError()),
      requireAllowed: () => Promise.reject(new AuthorizationUnavailableError()),
      resolveDataScope: () => Promise.reject(new AuthorizationUnavailableError()),
    },
    close: () => undefined,
    databaseCompatibility: { assertCompatible: () => undefined },
    organization: {
      closeAssignment: () => rejected(), closeEmployment: () => rejected(), closeOrganizationUnitPlacement: () => rejected(),
      closeSubjectAssociation: () => rejected(), createAssignment: () => rejected(), createEmployment: () => rejected(),
      createOrganizationUnit: () => rejected(), createOrganizationUnitPlacement: () => rejected(), createPosition: () => rejected(),
      createSubjectAssociation: () => rejected(), createWorkforcePerson: () => rejected(), resolveWorkforceContext: () => rejected(),
    },
    queries: {
      applicationRegistry: { loadRegistry: () => rejected(), resolveDeepLink: () => rejected() },
      fileCenter: { authorizeDownload: () => rejected() },
      forms: { getRelease: () => rejected(), validateSubmission: () => rejected() },
      notifications: { get: () => rejected(), list: () => rejected(), unreadCount: () => rejected() },
      tasks: { get: () => rejected(), list: () => rejected() },
    },
    readiness: () => [{ healthy: false, name: "synthetic-platform", required: true }],
    sessions: { resolvePrincipal: () => Promise.reject(new BrowserSessionFailure("authentication_dependency_unavailable")) },
  };
  return Object.freeze(bindings);
}

export interface ProductionApiBindingDependencies {
  readonly checkCompatibility: typeof checkMigrationCompatibility;
  readonly connectSessions: (config: RedisSessionConnectionConfig) => Promise<Readonly<RedisSessionConnection>>;
  readonly createDatabase: (config: DatabaseConfig) => DatabaseRuntime;
  readonly createOidc: typeof createOidcClient;
  readonly createTokenVerifier: (config: ProductionApiConfiguration["oidcVerifier"]) => TokenVerifier;
  readonly loadConfiguration: () => Promise<Readonly<ProductionApiConfiguration>>;
}

const productionDependencies: ProductionApiBindingDependencies = Object.freeze({
  checkCompatibility: checkMigrationCompatibility,
  connectSessions: connectRedisSessionStore,
  createDatabase: createDatabaseRuntime,
  createOidc: createOidcClient,
  createTokenVerifier: createOidcTokenVerifier,
  loadConfiguration: loadProductionApiConfiguration,
});

function migrationPool(runtime: DatabaseRuntime): MigrationPool {
  const adapter = {
    connect: () => Promise.resolve({
      query: async (sql: string, values?: readonly unknown[]) => {
        const result = await runtime.execute(sql, values);
        return { rows: [...result.rows] };
      },
      release: () => undefined,
    }),
    end: () => Promise.resolve(),
  };
  return adapter as MigrationPool;
}

async function closeResources(
  sessions: Readonly<RedisSessionConnection> | undefined,
  database: DatabaseRuntime | undefined,
  timeoutMs: number,
): Promise<void> {
  const closing = Promise.allSettled([
    sessions?.close() ?? Promise.resolve(),
    database?.close() ?? Promise.resolve(),
  ]);
  let timer: NodeJS.Timeout | undefined;
  const results = await Promise.race([
    closing,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new Error("api_production_resource_close_timeout")); }, timeoutMs);
    }),
  ]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
  if (results.some((result) => result.status === "rejected")) throw new Error("api_production_resource_close_failed");
}

function assertProductionStartActive(signal: AbortSignal, state: { readonly closed: boolean }): void {
  if (state.closed || signal.aborted) throw new Error("api_start_cancelled");
}

function startupAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function authenticationCallbackUrl(pathAndQuery: string, redirectUri: string): string {
  const expected = new URL(redirectUri);
  const actual = new URL(pathAndQuery, expected);
  if (actual.origin !== expected.origin || actual.pathname !== expected.pathname || actual.hash ||
    actual.username || actual.password) {
    throw new BrowserSessionFailure("authentication_callback_invalid");
  }
  return actual.href;
}

export async function createProductionApiPlatformBindings(
  dependencies: ProductionApiBindingDependencies = productionDependencies,
  signal: AbortSignal = new AbortController().signal,
  cleanupTimeoutMs = 30_000,
): Promise<ApiPlatformBindings> {
  if (!Number.isSafeInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1 || cleanupTimeoutMs > 300_000) {
    throw new Error("api_production_cleanup_timeout_invalid");
  }
  if (startupAborted(signal)) throw new Error("api_start_cancelled");
  const configuration = await dependencies.loadConfiguration();
  if (startupAborted(signal)) throw new Error("api_start_cancelled");
  const tokenVerifier = dependencies.createTokenVerifier(configuration.oidcVerifier);
  let database: DatabaseRuntime | undefined;
  let sessions: Readonly<RedisSessionConnection> | undefined;
  let oidc: Readonly<OidcClientPort> | undefined;
  try {
    database = dependencies.createDatabase(configuration.database);
    sessions = await dependencies.connectSessions({
      connectTimeoutMs: configuration.pcBff.redisConnectTimeoutMs,
      password: configuration.pcBff.redisPassword,
      signal,
      url: configuration.pcBff.redisUrl,
    });
    if (startupAborted(signal)) throw new Error("api_start_cancelled");
    oidc = await dependencies.createOidc({
      clientId: configuration.pcBff.keycloakClientId,
      clientSecret: configuration.pcBff.keycloakClientSecret,
      issuer: configuration.pcBff.keycloakIssuer,
      redirectUri: configuration.pcBff.redirectUri,
      signal,
      timeoutSeconds: configuration.pcBff.oidcTimeoutSeconds,
    });
    if (startupAborted(signal)) throw new Error("api_start_cancelled");
  } catch (error) {
    try {
      await closeResources(sessions, database, cleanupTimeoutMs);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "api_production_initialization_cleanup_failed");
    }
    if (startupAborted(signal)) throw new Error("api_start_cancelled");
    throw error;
  }

  const activeDatabase = database;
  const activeSessions = sessions;
  const activeOidc = oidc;
  const state = { closed: false, databaseCompatible: false };
  const sessionService = createPcBffSessionService({
    audit: { record: () => rejected() },
    decryptionKeys: configuration.pcBff.sessionDecryptionKeys,
    encryptionKey: configuration.pcBff.sessionEncryptionKey,
    indexingKey: configuration.pcBff.sessionIndexingKey,
    loginTransactionTtlSeconds: configuration.pcBff.loginTransactionTtlSeconds,
    oidc: activeOidc,
    refreshLeaseTtlMs: configuration.pcBff.refreshLeaseTtlMs,
    sessionAbsoluteTtlSeconds: configuration.pcBff.sessionAbsoluteTtlSeconds,
    sessionIdleTtlSeconds: configuration.pcBff.sessionIdleTtlSeconds,
    store: createRedisBrowserSessionStore(activeSessions.executor),
    tokenVerifier,
  });
  const unavailable = createUnavailableBindings();

  return Object.freeze({
    ...unavailable,
    authentication: createPcAuthenticationHttpAdapter({
      allowedOrigins: [configuration.pcBff.allowedOrigin],
      cookieMaxAgeSeconds: configuration.pcBff.sessionAbsoluteTtlSeconds,
      service: sessionService,
    }),
    authenticationCallbackUrl: (pathAndQuery: string) =>
      authenticationCallbackUrl(pathAndQuery, configuration.pcBff.redirectUri),
    async close() {
      if (state.closed) return;
      state.closed = true;
      state.databaseCompatible = false;
      await closeResources(activeSessions, activeDatabase, cleanupTimeoutMs);
    },
    databaseCompatibility: {
      async assertCompatible(signal: AbortSignal) {
        assertProductionStartActive(signal, state);
        state.databaseCompatible = false;
        const report = await dependencies.checkCompatibility(
          migrationPool(activeDatabase),
          configuration.migrations,
          configuration.applicationSchemaVersion,
        );
        assertProductionStartActive(signal, state);
        if (!report.compatible) throw new Error("api_database_migration_incompatible");
        state.databaseCompatible = true;
      },
    },
    readiness: () => [
      { healthy: !state.closed && state.databaseCompatible, name: "application-database", required: true },
      { healthy: !state.closed && activeSessions.isReady(), name: "session-store", required: true },
      // No reviewed durable policy store or authentication-audit adapter exists yet.
      { healthy: false, name: "authorization-policy", required: true },
      { healthy: false, name: "authentication-audit", required: true },
    ],
    sessions: { resolvePrincipal: sessionService.resolvePrincipal },
  });
}

export const defaultApiPlatformBindingFactory: ApiPlatformBindingFactory = Object.freeze({
  create(configuration: Readonly<ApiRuntimeConfiguration>, signal?: AbortSignal) {
    if (configuration.environment === "production") {
      return createProductionApiPlatformBindings(
        productionDependencies,
        signal ?? new AbortController().signal,
        configuration.shutdownTimeoutMs,
      );
    }
    return createUnavailableBindings();
  },
});
