import { createHash } from "node:crypto";

import { createTraceContext } from "@ai-crm/observability";
import {
  createPostgresApplicationRegistryCapabilityProbe,
  createPostgresApplicationRegistryQueryService,
} from "@ai-crm/platform-app-registry";
import { createAuditService, createPostgresAuditCapabilityProbe, createPostgresAuditStore } from "@ai-crm/platform-audit";
import {
  AuthorizationUnavailableError,
  createAuthorizationService,
  createPostgresAuthorizationPersistence,
  type AuthorizationPolicyStore,
} from "@ai-crm/platform-authorization";
import { createOidcTokenVerifier, type TokenVerifier } from "@ai-crm/platform-auth-context";
import {
  createPostgresFormSchemaCapabilityProbe,
  createPostgresFormSchemaQueryService,
} from "@ai-crm/platform-form-schema";
import {
  createNotificationCenter,
  createPostgresNotificationStore,
  type NotificationAudit,
  type NotificationAuthorization,
} from "@ai-crm/platform-notifications";
import {
  createPostgresOrganizationService,
  type OrganizationCommandAuthorizer,
  type OrganizationPersistenceRuntime,
} from "@ai-crm/platform-organization";
import {
  createFileCenterService,
  createPostgresFileCenterStore,
  FileCenterError,
  type FileAudit,
  type FileAuthorizationRequest,
  type FileAuthorizer,
  type StorageAdapter,
} from "@ai-crm/platform-file-center";
import {
  createPostgresTaskCenterStore,
  createTaskCenter,
  type TaskAudit,
  type TaskAuthorization,
} from "@ai-crm/platform-task-center";
import { createTencentCosStorageAdapter, type TencentCosStorageAdapter } from "@ai-crm/platform-file-center/provider/tencent-cos";
import {
  checkMigrationCompatibility,
  createDatabaseRuntime,
  createPostgresRuntimeRoleCapabilityProbe,
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

function deterministicUuid(material: string): string {
  const value = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  value[12] = "5";
  value[16] = ((Number.parseInt(value[16] ?? "0", 16) & 3) | 8).toString(16);
  return `${value.slice(0, 8).join("")}-${value.slice(8, 12).join("")}-${value.slice(12, 16).join("")}-${value.slice(16, 20).join("")}-${value.slice(20).join("")}`;
}

function managementAuditPort(
  audit: ApiPlatformBindings["audit"],
  capability: "notification" | "task",
  decisionTraces: Map<string, string>,
) {
  return Object.freeze({
    async record(event: {
      readonly actor: { readonly principalId: string };
      readonly decisionId: string;
      readonly errorCode?: string;
      readonly operation: string;
      readonly phase: "attempted" | "failed" | "succeeded";
      readonly referenceId: string;
    }): Promise<void> {
      const traceId = decisionTraces.get(event.decisionId);
      if (traceId === undefined) throw new Error(`${capability}_audit_trace_unavailable`);
      const operationId = deterministicUuid(`${capability}\0${event.decisionId}\0${event.operation}\0${event.phase}\0${event.referenceId}`);
      try {
        await audit.record({
          action: `${capability}.${event.operation}`,
          actor: { actorId: event.actor.principalId, actorType: "authenticated_subject", workforcePersonId: event.actor.principalId },
          reason: { code: event.errorCode === undefined ? `${capability}_query` : `${capability}_query_failed` },
          resource: {
            resourceId: event.referenceId,
            resourceType: capability === "task" ? "platform.task-center.task-projection" : "platform.notifications.in-app-notification",
          },
          result: event.phase === "attempted" ? "attempted" : event.phase === "succeeded" ? "succeeded" : "failed",
          trace: { authorizationDecisionId: event.decisionId, operationId, traceId },
        });
      } catch (error) {
        decisionTraces.delete(event.decisionId);
        throw error;
      }
      if (event.phase !== "attempted") decisionTraces.delete(event.decisionId);
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
  readonly createFileStorage?: (config: ProductionApiConfiguration["fileCenter"]["cos"]) => TencentCosStorageAdapter;
  readonly createOidc: typeof createOidcClient;
  readonly createTokenVerifier: (config: ProductionApiConfiguration["oidcVerifier"]) => TokenVerifier;
  readonly loadConfiguration: () => Promise<Readonly<ProductionApiConfiguration>>;
}

const productionDependencies: ProductionApiBindingDependencies = Object.freeze({
  checkCompatibility: checkMigrationCompatibility,
  connectSessions: connectRedisSessionStore,
  createDatabase: createDatabaseRuntime,
  createFileStorage: createTencentCosStorageAdapter,
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
  try {
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
  const fileStorage: StorageAdapter & { readonly checkHealth: () => Promise<boolean> } = dependencies.createFileStorage?.(configuration.fileCenter.cos) ?? Object.freeze({
    checkHealth: () => Promise.resolve(false),
    createDownloadGrant: () => Promise.reject(new FileCenterError("file_center_storage_unavailable", { retryable: true })),
    createUploadGrant: () => Promise.reject(new FileCenterError("file_center_storage_unavailable", { retryable: true })),
    deleteObject: () => Promise.reject(new FileCenterError("file_center_storage_unavailable", { retryable: true })),
    inspectObject: () => Promise.reject(new FileCenterError("file_center_storage_unavailable", { retryable: true })),
    quarantineObject: () => Promise.reject(new FileCenterError("file_center_storage_unavailable", { retryable: true })),
    readObject: () => Promise.reject(new FileCenterError("file_center_storage_unavailable", { retryable: true })),
  });
  const fileAuthorizer: FileAuthorizer = Object.freeze({
    authorize: async (request: FileAuthorizationRequest) => {
      if (request.actor.actorType !== "authenticated_subject" || (request.action !== "file:upload" && request.action !== "file:download")) {
        return { allowed: false, decisionId: "file-center-unsupported-operation" };
      }
      const decision = await authorizationTrace.run(authorizationTrace.getStore() ?? createTraceContext().traceId, () => authorization.check({
        activeAssignmentIds: request.actor.assignmentId === undefined ? [] : [request.actor.assignmentId],
        ...(request.actor.assignmentId === undefined ? {} : { selectedAssignmentId: request.actor.assignmentId }),
        workforcePersonId: request.actor.actorId,
      }, { action: request.action === "file:upload" ? "upload" : "download", resource: "platform.file-center.file" }));
      return { allowed: decision.allowed, decisionId: decision.decisionId };
    },
  });
  const fileAudit: FileAudit = Object.freeze({
    async record(event: Parameters<FileAudit["record"]>[0]) {
      await audit.record({
        action: event.action,
        actor: { ...event.actor, ...(event.actor.actorType === "authenticated_subject" ? { workforcePersonId: event.actor.actorId } : {}) },
        reason: { code: "file_center_operation" },
        resource: { resourceId: event.resourceReference, resourceType: "platform.file-center.file" },
        result: event.result,
        trace: { authorizationDecisionId: event.authorizationDecisionId, operationId: event.operationId, traceId: event.traceId },
      });
    },
  });
  const fileCenterStore = createPostgresFileCenterStore(activeDatabase);
  const fileCenter = createFileCenterService(
    fileCenterStore,
    fileStorage,
    { scan: () => Promise.reject(new FileCenterError("file_center_scan_unavailable", { retryable: true })) },
    fileAuthorizer,
    fileAudit,
    configuration.fileCenter,
  );
  const auditCapability = createPostgresAuditCapabilityProbe(activeDatabase);
  const runtimeRoleCapability = createPostgresRuntimeRoleCapabilityProbe(activeDatabase);
  const applicationRegistryCapability = createPostgresApplicationRegistryCapabilityProbe(activeDatabase);
  const formSchemaCapability = createPostgresFormSchemaCapabilityProbe(activeDatabase);
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
  const taskStore = createPostgresTaskCenterStore(activeDatabase);
  const notificationStore = createPostgresNotificationStore(activeDatabase);
  const queryDecisionTraces = new Map<string, string>();
  const taskAuthorization: TaskAuthorization = Object.freeze({
    authorize: async ({ actor, operation }: Parameters<TaskAuthorization["authorize"]>[0]) => {
      if (operation !== "task_list") {
        throw new Error("task_object_or_mutation_authorization_unavailable");
      }
      const traceId = authorizationTrace.getStore() ?? createTraceContext().traceId;
      const decision = await authorizationTrace.run(traceId, () => authorization.check(
        { activeAssignmentIds: actor.activeAssignmentIds ?? [], workforcePersonId: actor.principalId },
        {
          action: "list",
          resource: "platform.task-center.task-projection",
        },
      ));
      queryDecisionTraces.set(decision.decisionId, traceId);
      return { allowed: decision.allowed, decisionId: decision.decisionId };
    },
  });
  const notificationAuthorization: NotificationAuthorization = Object.freeze({
    authorize: async ({ actor, operation }: Parameters<NotificationAuthorization["authorize"]>[0]) => {
      const action = operation === "notification_list" || operation === "notification_unread_count"
        ? "list"
        : operation === "notification_detail" ? "read" : undefined;
      if (action === undefined) throw new Error("notification_mutation_authorization_unavailable");
      const traceId = authorizationTrace.getStore() ?? createTraceContext().traceId;
      const decision = await authorizationTrace.run(traceId, () => authorization.check(
        { activeAssignmentIds: actor.activeAssignmentIds ?? [], workforcePersonId: actor.principalId },
        { action, resource: "platform.notifications.in-app-notification" },
      ));
      queryDecisionTraces.set(decision.decisionId, traceId);
      return { allowed: decision.allowed, decisionId: decision.decisionId };
    },
  });
  const tasks = createTaskCenter({
    audit: managementAuditPort(audit, "task", queryDecisionTraces) as TaskAudit,
    authorization: taskAuthorization,
    router: { complete: () => Promise.reject(new Error("task_source_router_unavailable")) },
    sourceReader: { get: () => Promise.reject(new Error("task_source_reader_unavailable")) },
    store: taskStore,
  });
  const notifications = createNotificationCenter({
    audit: managementAuditPort(audit, "notification", queryDecisionTraces) as NotificationAudit,
    authorization: notificationAuthorization,
    preference: { evaluate: () => Promise.reject(new Error("notification_preference_unavailable")) },
    resolver: { resolve: () => Promise.reject(new Error("notification_recipient_resolver_unavailable")) },
    store: notificationStore,
  });
  const organization = createPostgresOrganizationService(
    organizationRuntime(activeDatabase),
    failClosedOrganizationAuthorizer,
  );
  const state = {
    applicationRegistryCapabilityReady: false,
    auditCapabilityReady: false,
    authorizationPolicyReady: false,
    closed: false,
    databaseCompatible: false,
    databaseHealthy: false,
    formSchemaCapabilityReady: false,
    fileCenterProviderReady: false,
    runtimeRoleCapabilityReady: false,
    notificationQueryReady: false,
    taskQueryReady: false,
  };
  let probeController = new AbortController();
  let probeGeneration = 0;
  let probeTimer: NodeJS.Timeout | undefined;
  type DependencyProbeName = "applicationRegistry" | "audit" | "authorizationPolicy" | "fileCenter" | "formSchema" | "notificationQuery" | "runtimeRole" | "taskQuery";
  const dependentProbeCompletions: Record<DependencyProbeName, Promise<void> | undefined> = {
    applicationRegistry: undefined,
    audit: undefined,
    authorizationPolicy: undefined,
    formSchema: undefined,
    fileCenter: undefined,
    notificationQuery: undefined,
    runtimeRole: undefined,
    taskQuery: undefined,
  };
  const stopDatabaseProbes = (): void => {
    probeGeneration += 1;
    if (probeTimer !== undefined) clearTimeout(probeTimer);
    probeTimer = undefined;
    probeController.abort();
    state.databaseHealthy = false;
    state.runtimeRoleCapabilityReady = false;
    state.auditCapabilityReady = false;
    state.authorizationPolicyReady = false;
    state.applicationRegistryCapabilityReady = false;
    state.formSchemaCapabilityReady = false;
    state.fileCenterProviderReady = false;
    state.notificationQueryReady = false;
    state.taskQueryReady = false;
  };
  const runDependencyProbe = async (
    name: DependencyProbeName,
    check: () => Promise<boolean>,
    publish: (healthy: boolean) => void,
    generation: number,
    controller: AbortController,
    signals: readonly AbortSignal[],
  ): Promise<void> => {
    if (probeIsObsolete(state, controller, generation, probeGeneration) ||
      signals.some((signal) => signal.aborted) || dependentProbeCompletions[name] !== undefined) return;
    const pending = check();
    const completion = pending.then(() => undefined, () => undefined);
    const trackedCompletion = completion.finally(() => {
      if (dependentProbeCompletions[name] === trackedCompletion) dependentProbeCompletions[name] = undefined;
    });
    dependentProbeCompletions[name] = trackedCompletion;
    const result = await boundedDependencyCheck(pending, configuration.databaseHealthProbe.timeoutMs, signals);
    if (probeIsObsolete(state, controller, generation, probeGeneration)) return;
    publish(result.healthy);
  };
  const runDependentProbes = async (
    generation: number,
    controller: AbortController,
    signals: readonly AbortSignal[],
  ): Promise<void> => {
    await Promise.all([
      runDependencyProbe("audit", () => auditCapability.check().then(({ status }) => status === "available"),
        (healthy) => { state.auditCapabilityReady = healthy; }, generation, controller, signals),
      runDependencyProbe("authorizationPolicy", () => hasCompleteCurrentPolicy(authorizationPersistence.store),
        (healthy) => { state.authorizationPolicyReady = healthy; }, generation, controller, signals),
      runDependencyProbe("runtimeRole", () => runtimeRoleCapability.check().then(({ status }) => status === "available"),
        (healthy) => { state.runtimeRoleCapabilityReady = healthy; }, generation, controller, signals),
      runDependencyProbe("fileCenter", async () => {
        const [providerReady] = await Promise.all([
          fileStorage.checkHealth(),
          fileCenterStore.findFile("00000000-0000-4000-8000-000000000000"),
        ]);
        return providerReady;
      },
        (healthy) => { state.fileCenterProviderReady = healthy; }, generation, controller, signals),
      runDependencyProbe("applicationRegistry", () => applicationRegistryCapability.check().then(({ status }) => status === "available"),
        (healthy) => { state.applicationRegistryCapabilityReady = healthy; }, generation, controller, signals),
      runDependencyProbe("formSchema", () => formSchemaCapability.check().then(({ status }) => status === "available"),
        (healthy) => { state.formSchemaCapabilityReady = healthy; }, generation, controller, signals),
      runDependencyProbe("taskQuery", () => taskStore.list({ limit: 1 }).then(() => true),
        (healthy) => { state.taskQueryReady = healthy; }, generation, controller, signals),
      runDependencyProbe("notificationQuery", () => notificationStore.unreadCount("api.capability-probe").then(() => true),
        (healthy) => { state.notificationQueryReady = healthy; }, generation, controller, signals),
    ]);
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
          state.runtimeRoleCapabilityReady = false;
          state.applicationRegistryCapabilityReady = false;
          state.formSchemaCapabilityReady = false;
          state.notificationQueryReady = false;
          state.taskQueryReady = false;
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
    try {
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
        state.runtimeRoleCapabilityReady = false;
        state.applicationRegistryCapabilityReady = false;
        state.formSchemaCapabilityReady = false;
        state.notificationQueryReady = false;
        state.taskQueryReady = false;
        void result.completion.then(() => { scheduleDatabaseProbe(generation, controller); });
        return;
      }
      await runDependentProbes(generation, controller, [signal, controller.signal]);
      assertProductionStartActive(signal, state);
      if (probeIsObsolete(state, controller, generation, probeGeneration)) throw new Error("api_start_cancelled");
      void result.completion.then(() => { scheduleDatabaseProbe(generation, controller); });
    } catch (error) {
      if (probeController === controller && probeGeneration === generation) {
        state.databaseCompatible = false;
        stopDatabaseProbes();
      }
      throw error;
    }
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
      queryDecisionTraces.clear();
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
      fileCenter,
      forms: formQueries,
      notifications,
      tasks,
    },
    readiness: () => [
      { healthy: !state.closed && state.databaseCompatible && state.databaseHealthy, name: "application-database", required: true },
      { healthy: !state.closed && activeSessions.isReady(), name: "session-store", required: true },
      { healthy: !state.closed && state.databaseHealthy && state.runtimeRoleCapabilityReady, name: "database-runtime-role", required: true },
      { healthy: !state.closed && state.databaseHealthy && state.runtimeRoleCapabilityReady && state.authorizationPolicyReady, name: "authorization-policy", required: true },
      // This observes static Audit prerequisites; every actual append still fails closed independently.
      { healthy: !state.closed && state.databaseHealthy && state.runtimeRoleCapabilityReady && state.auditCapabilityReady, name: "authentication-audit", required: true },
      { healthy: !state.closed && state.databaseHealthy && state.runtimeRoleCapabilityReady && state.applicationRegistryCapabilityReady, name: "application-registry-query", required: true },
      { healthy: !state.closed && state.databaseHealthy && state.runtimeRoleCapabilityReady && state.formSchemaCapabilityReady, name: "form-schema-query", required: true },
      { healthy: !state.closed && state.databaseHealthy && state.runtimeRoleCapabilityReady && state.taskQueryReady, name: "task-query", required: true },
      { healthy: !state.closed && state.databaseHealthy && state.runtimeRoleCapabilityReady && state.notificationQueryReady, name: "notification-query", required: true },
      { healthy: !state.closed && state.databaseHealthy && state.runtimeRoleCapabilityReady && state.fileCenterProviderReady, name: "file-center-provider", required: true },
    ],
    sessions: { resolvePrincipal: sessionService.resolvePrincipal, sessionForMutation: sessionService.sessionForMutation },
  });
  } catch (error) {
    try {
      await closeResources(activeSessions, activeDatabase, cleanupTimeoutMs);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "api_production_composition_cleanup_failed");
    }
    throw error;
  }
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
