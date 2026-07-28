import { createTraceContext } from "@ai-crm/observability";
import { createPostgresApplicationRegistryQueryService } from "@ai-crm/platform-app-registry";
import { createAuditService, createPostgresAuditCapabilityProbe, createPostgresAuditStore } from "@ai-crm/platform-audit";
import {
  AuthorizationUnavailableError,
  createAuthorizationService,
  createPostgresAuthorizationPersistence,
  type AuthorizationPolicyStore,
} from "@ai-crm/platform-authorization";
import { createOidcTokenVerifier, type TokenVerifier } from "@ai-crm/platform-auth-context";
import { createPostgresFormSchemaQueryService } from "@ai-crm/platform-form-schema";
import {
  createPostgresOrganizationService,
  type OrganizationCommandAuthorizer,
  type OrganizationPersistenceRuntime,
} from "@ai-crm/platform-organization";
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
import type { AuthenticationAuditEvent, AuthenticationAuditPort } from "./auth/session-service.js";
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

const failClosedOrganizationAuthorizer: OrganizationCommandAuthorizer = Object.freeze({
  authorize: () => Promise.reject(new Error("organization_write_authorization_unavailable")),
});

function organizationRuntime(database: DatabaseRuntime): OrganizationPersistenceRuntime {
  return Object.freeze({
    execute<Row = Record<string, unknown>>(sql: string, values?: readonly unknown[]) {
      return database.execute<Row>(sql, values);
    },
    recordAuditIntent: () => Promise.reject(new Error("organization_write_audit_unavailable")),
    recordEventIntent: () => Promise.reject(new Error("organization_write_event_unavailable")),
    withTransaction<T>(work: () => Promise<T>) {
      return database.withTransaction(work);
    },
  });
}

function authenticationAuditPort(audit: ApiPlatformBindings["audit"]): AuthenticationAuditPort {
  return Object.freeze({
    async record(event: AuthenticationAuditEvent): Promise<void> {
      const command = {
        action: `authentication.${event.action}`,
        actor: { actorId: "api.pc_bff", actorType: "system" },
        reason: { code: "authentication_event" },
        resource: {
          resourceId: event.sessionReference ?? event.action,
          resourceType: event.sessionReference === undefined ? "authentication_attempt" : "pc_bff_session",
        },
        result: event.result,
        trace: { operationId: event.operationId, traceId: event.traceId },
      } as const;
      try {
        await audit.record(command);
      } catch {
        await audit.record(command);
      }
    },
  });
}

async function hasCompleteCurrentPolicy(store: AuthorizationPolicyStore): Promise<boolean> {
  try {
    const version = await store.currentVersion();
    const snapshot = await store.load(version);
    if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) return false;
    const candidate = snapshot as Record<string, unknown>;
    return Array.isArray(candidate["permissions"]) && candidate["permissions"].length > 0 &&
      Array.isArray(candidate["roles"]) && candidate["roles"].length > 0 &&
      Array.isArray(candidate["grants"]) && candidate["grants"].length > 0;
  } catch {
    return false;
  }
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
    browserSecurity: { allowedOrigins: ["https://workbench.invalid"] },
    authorization: {
      batchCheck: () => Promise.reject(new AuthorizationUnavailableError()),
      check: () => Promise.reject(new AuthorizationUnavailableError()),
      invalidatePolicyVersion: () => Promise.reject(new AuthorizationUnavailableError()),
      requireAllowed: () => Promise.reject(new AuthorizationUnavailableError()),
      resolveDataScope: () => Promise.reject(new AuthorizationUnavailableError()),
    },
    authorizationTrace: { run: async (_traceId, work) => work() },
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
      fileCenter: { authorizeDownload: () => rejected(), completeUpload: () => rejected(), createUploadSession: () => rejected() },
      forms: { getRelease: () => rejected(), validateSubmission: () => rejected() },
      notifications: { get: () => rejected(), list: () => rejected(), unreadCount: () => rejected() },
      tasks: { get: () => rejected(), list: () => rejected() },
    },
    readiness: () => [{ healthy: false, name: "synthetic-platform", required: true }],
    sessions: {
      resolvePrincipal: () => Promise.reject(new BrowserSessionFailure("authentication_dependency_unavailable")),
      sessionForMutation: () => Promise.reject(new BrowserSessionFailure("authentication_dependency_unavailable")),
    },
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

function probeIsObsolete(
  state: { readonly closed: boolean },
  controller: AbortController,
  generation: number,
  currentGeneration: number,
): boolean {
  return state.closed || controller.signal.aborted || generation !== currentGeneration;
}

function boundedDatabaseHealthCheck(
  database: DatabaseRuntime,
  timeoutMs: number,
  signals: readonly AbortSignal[],
): Promise<Readonly<{ readonly completion: Promise<void>; readonly healthy: boolean }>> {
  if (signals.some((signal) => signal.aborted)) {
    return Promise.resolve(Object.freeze({ completion: Promise.resolve(), healthy: false }));
  }
  const healthCheck = database.healthCheck();
  const completion = healthCheck.then(() => undefined, () => undefined);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (healthy: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const signal of signals) signal.removeEventListener("abort", aborted);
      resolve(Object.freeze({ completion, healthy }));
    };
    const aborted = (): void => { finish(false); };
    const timer = setTimeout(() => { finish(false); }, timeoutMs);
    timer.unref();
    for (const signal of signals) {
      if (signal.aborted) {
        finish(false);
        return;
      }
      signal.addEventListener("abort", aborted, { once: true });
    }
    void healthCheck.then(
      (health) => { finish(health.status === "ready"); },
      () => { finish(false); },
    );
  });
}

function boundedDependencyCheck(
  check: Promise<boolean>,
  timeoutMs: number,
  signals: readonly AbortSignal[],
): Promise<Readonly<{ readonly completion: Promise<void>; readonly healthy: boolean }>> {
  const completion = check.then(() => undefined, () => undefined);
  if (signals.some((signal) => signal.aborted)) {
    return Promise.resolve(Object.freeze({ completion, healthy: false }));
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (healthy: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const signal of signals) signal.removeEventListener("abort", aborted);
      resolve(Object.freeze({ completion, healthy }));
    };
    const aborted = (): void => { finish(false); };
    const timer = setTimeout(() => { finish(false); }, timeoutMs);
    timer.unref();
    for (const signal of signals) {
      if (signal.aborted) {
        finish(false);
        return;
      }
      signal.addEventListener("abort", aborted, { once: true });
    }
    void check.then(finish, () => { finish(false); });
  });
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
  const authorizationTrace = new AsyncLocalStorage<string>();
  const authorizationPersistence = createPostgresAuthorizationPersistence(activeDatabase);
  const authorization = createAuthorizationService({
    recorder: authorizationPersistence.recorder,
    store: authorizationPersistence.store,
  }, {
    cacheTtlSeconds: 60,
    traceId: () => authorizationTrace.getStore() ?? createTraceContext().traceId,
  });
  const audit = createAuditService(
    createPostgresAuditStore(activeDatabase),
    { authorize: () => Promise.reject(new Error("audit_read_authorization_unavailable")) },
    { fieldPolicies: {} },
  );
  const auditCapability = createPostgresAuditCapabilityProbe(activeDatabase);
  const applicationRegistryQueries = createPostgresApplicationRegistryQueryService(activeDatabase, {
    authorize: (request) => authorizationTrace.run(request.traceId, () => authorization.check(
      request.subject,
      { action: request.permission.action, resource: request.permission.resource },
    )),
  });
  const formQueries = createPostgresFormSchemaQueryService(activeDatabase, {
    authorize: (request) => authorizationTrace.run(request.traceId, () => authorization.check(
      request.subject,
      { action: request.permission.action, resource: request.permission.resource },
    )),
  });
  const organization = createPostgresOrganizationService(
    organizationRuntime(activeDatabase),
    failClosedOrganizationAuthorizer,
  );
  const state = {
    auditCapabilityReady: false,
    authorizationPolicyReady: false,
    closed: false,
    databaseCompatible: false,
    databaseHealthy: false,
  };
  let probeController = new AbortController();
  let probeGeneration = 0;
  let probeTimer: NodeJS.Timeout | undefined;
  let dependentProbeCompletion: Promise<void> | undefined;
  const stopDatabaseProbes = (): void => {
    probeGeneration += 1;
    if (probeTimer !== undefined) clearTimeout(probeTimer);
    probeTimer = undefined;
    probeController.abort();
    state.databaseHealthy = false;
    state.auditCapabilityReady = false;
    state.authorizationPolicyReady = false;
  };
  const runDependentProbes = async (
    generation: number,
    controller: AbortController,
    signals: readonly AbortSignal[],
  ): Promise<void> => {
    if (probeIsObsolete(state, controller, generation, probeGeneration) ||
      signals.some((signal) => signal.aborted) || dependentProbeCompletion !== undefined) return;
    const auditCheck = auditCapability.check().then(({ status }) => status === "available");
    const policyCheck = hasCompleteCurrentPolicy(authorizationPersistence.store);
    const auditResultPromise = boundedDependencyCheck(
      auditCheck,
      configuration.databaseHealthProbe.timeoutMs,
      signals,
    );
    const policyResultPromise = boundedDependencyCheck(
      policyCheck,
      configuration.databaseHealthProbe.timeoutMs,
      signals,
    );
    const completion = Promise.allSettled([auditCheck, policyCheck]).then(() => undefined);
    const trackedCompletion = completion.finally(() => {
      if (dependentProbeCompletion === trackedCompletion) dependentProbeCompletion = undefined;
    });
    dependentProbeCompletion = trackedCompletion;
    const [auditResult, policyResult] = await Promise.all([auditResultPromise, policyResultPromise]);
    if (probeIsObsolete(state, controller, generation, probeGeneration)) return;
    state.auditCapabilityReady = auditResult.healthy;
    state.authorizationPolicyReady = policyResult.healthy;
  };
  const scheduleDatabaseProbe = (generation: number, controller: AbortController): void => {
    if (probeIsObsolete(state, controller, generation, probeGeneration)) return;
    probeTimer = setTimeout(() => {
      probeTimer = undefined;
      void boundedDatabaseHealthCheck(
        activeDatabase,
        configuration.databaseHealthProbe.timeoutMs,
        [controller.signal],
      ).then((result) => {
        if (probeIsObsolete(state, controller, generation, probeGeneration)) return;
        state.databaseHealthy = result.healthy;
        if (result.healthy) void runDependentProbes(generation, controller, [controller.signal]);
        else {
          state.auditCapabilityReady = false;
          state.authorizationPolicyReady = false;
        }
        void result.completion.then(() => { scheduleDatabaseProbe(generation, controller); });
      });
    }, configuration.databaseHealthProbe.intervalMs);
    probeTimer.unref();
  };
  const startDatabaseProbes = async (signal: AbortSignal): Promise<void> => {
    stopDatabaseProbes();
    probeController = new AbortController();
    const controller = probeController;
    const generation = probeGeneration;
    const result = await boundedDatabaseHealthCheck(
      activeDatabase,
      configuration.databaseHealthProbe.timeoutMs,
      [signal, controller.signal],
    );
    assertProductionStartActive(signal, state);
    if (probeIsObsolete(state, controller, generation, probeGeneration)) throw new Error("api_start_cancelled");
    state.databaseHealthy = result.healthy;
    if (!result.healthy) {
      state.auditCapabilityReady = false;
      state.authorizationPolicyReady = false;
      void result.completion.then(() => { scheduleDatabaseProbe(generation, controller); });
      return;
    }
    await runDependentProbes(generation, controller, [signal, controller.signal]);
    assertProductionStartActive(signal, state);
    if (probeIsObsolete(state, controller, generation, probeGeneration)) throw new Error("api_start_cancelled");
    void result.completion.then(() => { scheduleDatabaseProbe(generation, controller); });
  };
  const sessionService = createPcBffSessionService({
    audit: authenticationAuditPort(audit),
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
    audit,
    authentication: createPcAuthenticationHttpAdapter({
      allowedOrigins: [configuration.pcBff.allowedOrigin],
      cookieMaxAgeSeconds: configuration.pcBff.sessionAbsoluteTtlSeconds,
      service: sessionService,
    }),
    authenticationCallbackUrl: (pathAndQuery: string) =>
      authenticationCallbackUrl(pathAndQuery, configuration.pcBff.redirectUri),
    browserSecurity: { allowedOrigins: [configuration.pcBff.allowedOrigin] },
    authorization,
    authorizationTrace: {
      run: async <T>(traceId: string, work: () => Promise<T>) => authorizationTrace.run(traceId, work),
    },
    async close() {
      if (state.closed) return;
      state.closed = true;
      state.databaseCompatible = false;
      state.authorizationPolicyReady = false;
      stopDatabaseProbes();
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
        await startDatabaseProbes(signal);
      },
    },
    organization,
    queries: {
      ...unavailable.queries,
      applicationRegistry: applicationRegistryQueries,
      forms: formQueries,
    },
    readiness: () => [
      { healthy: !state.closed && state.databaseCompatible && state.databaseHealthy, name: "application-database", required: true },
      { healthy: !state.closed && activeSessions.isReady(), name: "session-store", required: true },
      { healthy: !state.closed && state.databaseHealthy && state.authorizationPolicyReady, name: "authorization-policy", required: true },
      // This observes static Audit prerequisites; every actual append still fails closed independently.
      { healthy: !state.closed && state.databaseHealthy && state.auditCapabilityReady, name: "authentication-audit", required: true },
      { healthy: false, name: "application-registry-query", required: true },
      { healthy: false, name: "form-schema-query", required: true },
      { healthy: false, name: "file-center-provider", required: true },
    ],
    sessions: { resolvePrincipal: sessionService.resolvePrincipal, sessionForMutation: sessionService.sessionForMutation },
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
import { AsyncLocalStorage } from "node:async_hooks";
