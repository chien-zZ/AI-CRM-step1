import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createProductionApiPlatformBindings,
  type ProductionApiBindingDependencies,
} from "./composition-factory.js";
import type { ProductionApiConfiguration } from "./production-config.js";

const configuration: ProductionApiConfiguration = {
  applicationSchemaVersion: "0.0.0",
  database: {
    applicationName: "ai_crm_api",
    connectionString: "postgresql://user:secret@database:5432/ai_crm",
    connectionTimeoutMs: 1_000,
    idleTimeoutMs: 30_000,
    maxConnections: 10,
    statementTimeoutMs: 15_000,
  },
  databaseHealthProbe: { intervalMs: 1_000, timeoutMs: 100 },
  fileCenter: {
    cos: { bucket: "synthetic-test-1250000000", region: "ap-test", secretId: "synthetic-id", secretKey: "synthetic-key", timeoutMs: 1_000 },
    downloadGrantTtlMs: 60_000,
    maximumScanBytes: 1_024,
    maximumUploadBytes: 1_024,
    uploadSessionTtlMs: 300_000,
  },
  migrations: ["/app/packages/database/migrations"],
  oidcVerifier: {
    audience: "ai-crm-api",
    clientId: "ai-crm-pc-bff",
    clockToleranceSeconds: 30,
    issuer: "https://identity.example.test/realms/ai-crm",
    jwksCacheMaxAgeMs: 3_600_000,
    jwksCooldownMs: 30_000,
    jwksTimeoutMs: 5_000,
    jwksUri: "https://identity.example.test/realms/ai-crm/protocol/openid-connect/certs",
  },
  pcBff: {
    allowedOrigin: "https://workbench.example.test",
    keycloakAudience: "ai-crm-api",
    keycloakClientId: "ai-crm-pc-bff",
    keycloakClientSecret: "c".repeat(43),
    keycloakIssuer: "https://identity.example.test/realms/ai-crm",
    loginTransactionTtlSeconds: 180,
    oidcTimeoutSeconds: 5,
    redirectUri: "https://api.example.test/auth/pc/callback",
    refreshLeaseTtlMs: 10_000,
    redisConnectTimeoutMs: 1_000,
    redisPassword: "redis-secret-value",
    redisUrl: "rediss://redis.example.test:6379",
    sessionAbsoluteTtlSeconds: 28_800,
    sessionDecryptionKeys: [{ id: "current", value: Buffer.alloc(32, 7) }],
    sessionEncryptionKey: { id: "current", value: Buffer.alloc(32, 7) },
    sessionIdleTtlSeconds: 1_800,
    sessionIndexingKey: Buffer.alloc(32, 9),
  },
};

function dependencies(compatible = true): {
  readonly closeDatabase: ReturnType<typeof vi.fn>;
  readonly closeSessions: ReturnType<typeof vi.fn>;
  readonly healthCheck: ReturnType<typeof vi.fn>;
  readonly execute: ReturnType<typeof vi.fn>;
  readonly withTransaction: ReturnType<typeof vi.fn>;
  readonly value: ProductionApiBindingDependencies;
} {
  const closeDatabase = vi.fn(() => Promise.resolve());
  const closeSessions = vi.fn(() => Promise.resolve());
  const healthCheck = vi.fn(() => Promise.resolve({ latencyMs: 1, status: "ready" as const }));
  const execute = vi.fn(() => Promise.resolve({ rowCount: 0, rows: [] }));
  const withTransaction = vi.fn(<T>(work: () => Promise<T>) => work());
  return {
    closeDatabase,
    closeSessions,
    healthCheck,
    execute,
    withTransaction,
    value: {
      checkCompatibility: vi.fn(() => Promise.resolve({
        applicationSchemaVersion: "0.0.0",
        compatible,
        currentMigrationVersion: "0000000011",
        issues: compatible ? [] : [{ kind: "missing-migration" as const, migrationVersion: "0000000011" }],
      })),
      connectSessions: vi.fn(() => Promise.resolve({
        close: closeSessions,
        executor: { sendCommand: vi.fn(() => Promise.resolve(undefined)) },
        isReady: () => true,
      })),
      createDatabase: vi.fn(() => ({
        abortSignalSupport: true as const,
        close: closeDatabase,
        execute,
        healthCheck,
        withTransaction: <T>(work: () => Promise<T>) => withTransaction(work) as Promise<T>,
      })),
      createOidc: vi.fn(() => Promise.resolve({
        beginLogin: vi.fn(),
        endSessionUrl: () => undefined,
        exchangeCallback: vi.fn(),
        refresh: vi.fn(),
      })),
      createTokenVerifier: vi.fn(() => ({ verify: vi.fn() })),
      loadConfiguration: vi.fn(() => Promise.resolve(configuration)),
    },
  };
}

const runtimeRoleCapabilities = Object.freeze({
  bypassrls_denied: true,
  createdb_denied: true,
  createrole_denied: true,
  database_create_denied: true,
  exact_runtime_role: true,
  login_enabled: true,
  public_schema_create_denied: true,
  public_schema_usage_denied: true,
  replication_denied: true,
  role_membership_denied: true,
  superuser_denied: true,
  temporary_denied: true,
});

const auditCapabilities = Object.freeze({
  advisory_lock_executable: true,
  hash_function_executable: true,
  operation_receipts_present: true,
  operation_receipts_privileges: true,
  records_present: true,
  records_privileges: true,
  schema_usage: true,
  transaction_read_write: true,
});

const applicationRegistryCapabilities = Object.freeze({
  applications_columns: true,
  applications_present: true,
  applications_select: true,
  navigation_columns: true,
  navigation_present: true,
  navigation_select: true,
  routes_columns: true,
  routes_present: true,
  routes_select: true,
  schema_usage: true,
});

const formSchemaCapabilities = Object.freeze({
  release_status_columns: true,
  release_status_present: true,
  release_status_select: true,
  releases_columns: true,
  releases_present: true,
  releases_select: true,
  schema_usage: true,
});

describe("production API platform binding factory", () => {
  it("closes acquired resources when composition after connection fails", async () => {
    const fixture = dependencies();
    const failure = new Error("synthetic storage composition failure");
    const failingDependencies = { ...fixture.value, createFileStorage: vi.fn(() => { throw failure; }) };

    await expect(createProductionApiPlatformBindings(failingDependencies)).rejects.toBe(failure);
    expect(fixture.closeSessions).toHaveBeenCalledTimes(1);
    expect(fixture.closeDatabase).toHaveBeenCalledTimes(1);
  });

  it("checks migration compatibility, stays fail-closed for unresolved capabilities, and closes once", async () => {
    const fixture = dependencies();
    const bindings = await createProductionApiPlatformBindings(fixture.value);
    const signal = new AbortController().signal;

    expect(bindings.readiness()).toEqual([
      { healthy: false, name: "application-database", required: true },
      { healthy: true, name: "session-store", required: true },
      { healthy: false, name: "database-runtime-role", required: true },
      { healthy: false, name: "authorization-policy", required: true },
      { healthy: false, name: "authentication-audit", required: true },
      { healthy: false, name: "application-registry-query", required: true },
      { healthy: false, name: "form-schema-query", required: true },
      { healthy: false, name: "task-query", required: true },
      { healthy: false, name: "notification-query", required: true },
      { healthy: false, name: "file-center-provider", required: true },
    ]);
    await bindings.databaseCompatibility.assertCompatible(signal);
    expect(bindings.readiness()[0]).toMatchObject({ healthy: true });
    expect(bindings.readiness()[3]).toMatchObject({ healthy: false });
    expect(bindings.readiness()[4]).toMatchObject({ healthy: false });
    expect(bindings.authenticationCallbackUrl("/auth/pc/callback?code=value&state=state"))
      .toBe("https://api.example.test/auth/pc/callback?code=value&state=state");
    let callbackFailure: unknown;
    try {
      bindings.authenticationCallbackUrl("//attacker.example/callback");
    } catch (error) {
      callbackFailure = error;
    }
    expect(callbackFailure).toMatchObject({ code: "authentication_callback_invalid" });
    await bindings.close?.();
    await bindings.close?.();
    expect(fixture.closeSessions).toHaveBeenCalledTimes(1);
    expect(fixture.closeDatabase).toHaveBeenCalledTimes(1);
    expect(bindings.readiness().every(({ healthy }) => !healthy)).toBe(true);
  });

  it("becomes ready only after loading a complete authoritative policy", async () => {
    const fixture = dependencies();
    const snapshot = {
      grants: [{
        grantId: "33333333-3333-4333-8333-333333333333",
        roleId: "55555555-5555-4555-8555-555555555555",
        subject: { kind: "workforce_person" as const, workforcePersonId: "44444444-4444-4444-8444-444444444444" },
        validFrom: "2026-01-01T00:00:00.000Z",
      }],
      permissions: [
        { action: "list", code: "platform.notifications.in-app-notification:list", resource: "platform.notifications.in-app-notification", scopeDimensions: [] },
        { action: "list", code: "platform.task-center.task-projection:list", resource: "platform.task-center.task-projection", scopeDimensions: [] },
        { action: "read", code: "synthetic.record:read", resource: "synthetic.record", scopeDimensions: [] },
      ],
      roles: [{ permissions: [
        { permissionCode: "platform.notifications.in-app-notification:list", scope: { terms: [{ kind: "all" as const }], version: 1 as const } },
        { permissionCode: "platform.task-center.task-projection:list", scope: { terms: [{ kind: "all" as const }], version: 1 as const } },
        { permissionCode: "synthetic.record:read", scope: { terms: [{ kind: "all" as const }], version: 1 as const } },
      ], roleId: "55555555-5555-4555-8555-555555555555" }],
      version: "baseline-v1",
    };
    const canonical = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
      if (typeof value === "object" && value !== null) {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
      }
      return JSON.stringify(value);
    };
    const contentDigest = createHash("sha256").update(canonical(snapshot)).digest("hex");
    fixture.execute.mockImplementation((sql: string) => {
      if (sql.includes("has_schema_privilege(current_user, 'audit'")) {
        return Promise.resolve({ rowCount: 1, rows: [auditCapabilities] });
      }
      if (sql.includes("from pg_catalog.pg_roles role")) {
        return Promise.resolve({ rowCount: 1, rows: [runtimeRoleCapabilities] });
      }
      if (sql.includes("to_regclass('app_registry.applications')")) {
        return Promise.resolve({ rowCount: 1, rows: [applicationRegistryCapabilities] });
      }
      if (sql.includes("to_regclass('form_schema.releases')")) {
        return Promise.resolve({ rowCount: 1, rows: [formSchemaCapabilities] });
      }
      if (sql.includes("authorization_core.current_policy")) {
        return Promise.resolve({ rowCount: 1, rows: [{ content_digest: contentDigest, contract_version: "authorization-policy.v1", version: snapshot.version }] });
      }
      if (sql.includes("authorization_core.policy_versions")) {
        return Promise.resolve({ rowCount: 1, rows: [{ content_digest: contentDigest, contract_version: "authorization-policy.v1", snapshot, version: snapshot.version }] });
      }
      if (sql.startsWith("insert into authorization_core.decision_records")) {
        return Promise.resolve({ rowCount: 1, rows: [{}] });
      }
      return Promise.resolve({ rowCount: 0, rows: [] });
    });
    const bindings = await createProductionApiPlatformBindings(fixture.value);
    await bindings.databaseCompatibility.assertCompatible(new AbortController().signal);
    expect(bindings.readiness().slice(0, 9).every(({ healthy }) => healthy)).toBe(true);
    expect(bindings.readiness().slice(9).every(({ healthy }) => !healthy)).toBe(true);
    const traceId = "abcdefabcdefabcdefabcdefabcdefab";
    await expect(bindings.authorizationTrace.run(traceId, () => bindings.authorization.check({
      activeAssignmentIds: [],
      workforcePersonId: "44444444-4444-4444-8444-444444444444",
    }, { action: "read", resource: "synthetic.record" }))).resolves.toMatchObject({ allowed: true });
    expect(fixture.execute.mock.calls.some(([sql]) =>
      typeof sql === "string" && sql.startsWith("insert into authorization_core.decision_records"))).toBe(true);
    expect(fixture.execute.mock.calls.some(([sql, values]) =>
      typeof sql === "string" && sql.startsWith("insert into authorization_core.decision_records") &&
      Array.isArray(values) && values.includes(traceId))).toBe(true);
    const actor = { activeAssignmentIds: ["11111111-1111-4111-8111-111111111111"], principalId: "44444444-4444-4444-8444-444444444444" };
    await expect(bindings.queries.tasks.list({ actor, limit: 1 })).resolves.toEqual({ items: [] });
    await expect(bindings.queries.notifications.list({ actor, limit: 1 })).resolves.toEqual({ items: [] });
    await expect(bindings.queries.tasks.get(actor, { sourceTaskId: "task.synthetic", sourceType: "workflow" }))
      .rejects.toMatchObject({ code: "TASK_AUTHORIZATION_FAILED" });
    expect(fixture.execute.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("platform_task_center.task_projections"))).toBe(true);
    expect(fixture.execute.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("platform_notifications.in_app_notifications"))).toBe(true);
    expect(fixture.execute.mock.calls.some(([sql, values]) => typeof sql === "string" && sql.startsWith("insert into audit.records") &&
      Array.isArray(values) && values.includes("task.task_list"))).toBe(true);
    expect(fixture.execute.mock.calls.some(([sql, values]) => typeof sql === "string" && sql.startsWith("insert into audit.records") &&
      Array.isArray(values) && values.includes("notification.notification_list"))).toBe(true);
    const recordedSqlCalls = fixture.execute.mock.calls as unknown as ReadonlyArray<readonly [string, readonly unknown[] | undefined]>;
    const queryAuditCalls = recordedSqlCalls.filter(([sql, values]) =>
      sql.startsWith("insert into audit.records") && Array.isArray(values) &&
      (values.includes("task.task_list") || values.includes("notification.notification_list")));
    for (const [, auditValues] of queryAuditCalls) {
      if (!Array.isArray(auditValues)) throw new Error("query audit values missing");
      const decisionCall = recordedSqlCalls.find(([sql, decisionValues]) =>
        sql.startsWith("insert into authorization_core.decision_records") && Array.isArray(decisionValues) &&
        decisionValues[0] === auditValues[13]);
      expect(decisionCall?.[1]?.[12]).toBe(auditValues[12]);
    }
    await bindings.close?.();
  });

  it("keeps database-backed capabilities unavailable for a privileged or misconfigured connection role", async () => {
    const fixture = dependencies();
    fixture.execute.mockImplementation((sql: string) => {
      if (sql.includes("from pg_catalog.pg_roles role")) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{ ...runtimeRoleCapabilities, exact_runtime_role: false }],
        });
      }
      if (sql.includes("to_regclass('app_registry.applications')")) {
        return Promise.resolve({ rowCount: 1, rows: [applicationRegistryCapabilities] });
      }
      if (sql.includes("to_regclass('form_schema.releases')")) {
        return Promise.resolve({ rowCount: 1, rows: [formSchemaCapabilities] });
      }
      return Promise.resolve({ rowCount: 0, rows: [] });
    });
    const bindings = await createProductionApiPlatformBindings(fixture.value);
    await bindings.databaseCompatibility.assertCompatible(new AbortController().signal);

    expect(bindings.readiness()[2]).toMatchObject({ healthy: false, name: "database-runtime-role" });
    expect(bindings.readiness()[5]).toMatchObject({ healthy: false, name: "application-registry-query" });
    expect(bindings.readiness()[6]).toMatchObject({ healthy: false, name: "form-schema-query" });
    expect(fixture.execute.mock.calls.some(([sql]) =>
      typeof sql === "string" && sql.includes("to_regclass('app_registry.applications')"))).toBe(true);
    expect(fixture.execute.mock.calls.some(([sql]) =>
      typeof sql === "string" && sql.includes("to_regclass('form_schema.releases')"))).toBe(true);
    await bindings.close?.();
  });

  it("fails organization writes before database access", async () => {
    const fixture = dependencies();
    const bindings = await createProductionApiPlatformBindings(fixture.value);
    await expect(bindings.organization.createWorkforcePerson({
      actor: { actorId: "api.pc_bff", actorType: "system" },
      operationId: "11111111-1111-4111-8111-111111111111",
      reason: "not_authorized",
      recordedAt: "2026-07-28T00:00:00.000Z",
      traceId: "1234567890abcdef1234567890abcdef",
      workforcePersonId: "22222222-2222-4222-8222-222222222222",
    })).rejects.toThrow();
    expect(fixture.execute).not.toHaveBeenCalled();
    await bindings.close?.();
  });

  it("records real authentication events through the durable audit service", async () => {
    const fixture = dependencies();
    const sendCommand = vi.fn((command: readonly string[]) =>
      Promise.resolve(command[0] === "SET" ? "OK" : undefined));
    const value: ProductionApiBindingDependencies = {
      ...fixture.value,
      connectSessions: vi.fn(() => Promise.resolve({
        close: fixture.closeSessions,
        executor: { sendCommand },
        isReady: () => true,
      })),
      createOidc: vi.fn(() => Promise.resolve({
        beginLogin: vi.fn(() => Promise.resolve({
          authorizationUrl: "https://identity.example.test/authorize?state=opaque",
          transaction: {
            codeVerifier: "v".repeat(43), nonce: "n".repeat(43), returnTo: "/", state: "s".repeat(43),
          },
        })),
        endSessionUrl: () => undefined,
        exchangeCallback: vi.fn(),
        refresh: vi.fn(),
      })),
    };
    const bindings = await createProductionApiPlatformBindings(value);
    await expect(bindings.authentication.beginLogin("/")).resolves.toMatchObject({ status: 302 });
    const append = fixture.execute.mock.calls.find(([sql]) =>
      typeof sql === "string" && sql.startsWith("insert into audit.records"));
    expect(append?.[1]).toEqual(expect.arrayContaining([
      "authentication.login_started", "api.pc_bff", "system", "authentication_event",
    ]));
    expect(JSON.stringify(append)).not.toContain("identity.example.test/authorize");
    await bindings.close?.();
  });

  it("fails authentication closed when durable audit append fails", async () => {
    const fixture = dependencies();
    fixture.execute.mockImplementation((sql: string) => sql.startsWith("insert into audit.records")
      ? Promise.reject(new Error("audit unavailable"))
      : Promise.resolve({ rowCount: 0, rows: [] }));
    const sendCommand = vi.fn((command: readonly string[]) =>
      Promise.resolve(command[0] === "SET" ? "OK" : undefined));
    const value: ProductionApiBindingDependencies = {
      ...fixture.value,
      connectSessions: vi.fn(() => Promise.resolve({
        close: fixture.closeSessions,
        executor: { sendCommand },
        isReady: () => true,
      })),
      createOidc: vi.fn(() => Promise.resolve({
        beginLogin: vi.fn(() => Promise.resolve({
          authorizationUrl: "https://identity.example.test/authorize?state=opaque",
          transaction: {
            codeVerifier: "v".repeat(43), nonce: "n".repeat(43), returnTo: "/", state: "s".repeat(43),
          },
        })),
        endSessionUrl: () => undefined,
        exchangeCallback: vi.fn(),
        refresh: vi.fn(),
      })),
    };
    const bindings = await createProductionApiPlatformBindings(value);
    await expect(bindings.authentication.beginLogin("/")).resolves.toMatchObject({ status: 503 });
    expect(sendCommand.mock.calls.some(([command]) => command[0] === "GETDEL")).toBe(true);
    await bindings.close?.();
  });

  it("retries an uncertain committed authentication audit with the same receipt and no duplicate record", async () => {
    const fixture = dependencies();
    let receipt: { audit_id: string; fingerprint: string } | undefined;
    fixture.execute.mockImplementation((sql: string, values?: readonly unknown[]) => {
      if (sql.startsWith("select audit_id, fingerprint from audit.operation_receipts")) {
        return Promise.resolve({ rowCount: receipt === undefined ? 0 : 1, rows: receipt === undefined ? [] : [receipt] });
      }
      if (sql.startsWith("insert into audit.operation_receipts")) {
        receipt = { audit_id: String(values?.[1]), fingerprint: String(values?.[2]) };
      }
      return Promise.resolve({ rowCount: 1, rows: [] });
    });
    let transactionCalls = 0;
    fixture.withTransaction.mockImplementation(async <T>(work: () => Promise<T>) => {
      const result = await work();
      transactionCalls += 1;
      if (transactionCalls === 1) throw new Error("commit result uncertain");
      return result;
    });
    const sendCommand = vi.fn((command: readonly string[]) =>
      Promise.resolve(command[0] === "SET" ? "OK" : undefined));
    const value: ProductionApiBindingDependencies = {
      ...fixture.value,
      connectSessions: vi.fn(() => Promise.resolve({ close: fixture.closeSessions, executor: { sendCommand }, isReady: () => true })),
      createOidc: vi.fn(() => Promise.resolve({
        beginLogin: vi.fn(() => Promise.resolve({
          authorizationUrl: "https://identity.example.test/authorize?state=opaque",
          transaction: { codeVerifier: "v".repeat(43), nonce: "n".repeat(43), returnTo: "/", state: "s".repeat(43) },
        })),
        endSessionUrl: () => undefined, exchangeCallback: vi.fn(), refresh: vi.fn(),
      })),
    };
    const bindings = await createProductionApiPlatformBindings(value);
    await expect(bindings.authentication.beginLogin("/")).resolves.toMatchObject({ status: 302 });
    expect(fixture.execute.mock.calls.filter(([sql]) =>
      typeof sql === "string" && sql.startsWith("insert into audit.records"))).toHaveLength(1);
    expect(transactionCalls).toBe(2);
    await bindings.close?.();
  });

  it("rejects an incompatible database without publishing database readiness", async () => {
    const fixture = dependencies(false);
    const bindings = await createProductionApiPlatformBindings(fixture.value);
    await expect(bindings.databaseCompatibility.assertCompatible(new AbortController().signal))
      .rejects.toThrow("api_database_migration_incompatible");
    expect(bindings.readiness()[0]).toMatchObject({ healthy: false });
    await bindings.close?.();
  });

  it("marks runtime database loss unavailable and restores only after a later successful probe", async () => {
    vi.useFakeTimers();
    try {
      const fixture = dependencies();
      const bindings = await createProductionApiPlatformBindings(fixture.value);
      await bindings.databaseCompatibility.assertCompatible(new AbortController().signal);
      expect(bindings.readiness()[0]).toMatchObject({ healthy: true });

      fixture.healthCheck.mockResolvedValueOnce({ latencyMs: 1, status: "unavailable" });
      await vi.advanceTimersByTimeAsync(configuration.databaseHealthProbe.intervalMs);
      expect(bindings.readiness()[0]).toMatchObject({ healthy: false });

      fixture.healthCheck.mockResolvedValueOnce({ latencyMs: 1, status: "ready" });
      await vi.advanceTimersByTimeAsync(configuration.databaseHealthProbe.intervalMs);
      expect(bindings.readiness()[0]).toMatchObject({ healthy: true });

      await bindings.close?.();
      const callsAtClose = fixture.healthCheck.mock.calls.length;
      await vi.advanceTimersByTimeAsync(configuration.databaseHealthProbe.intervalMs * 2);
      expect(fixture.healthCheck).toHaveBeenCalledTimes(callsAtClose);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a health result that arrives after the application-side timeout", async () => {
    vi.useFakeTimers();
    try {
      const fixture = dependencies();
      let resolveHealth: ((value: { latencyMs: number; status: "ready" }) => void) | undefined;
      fixture.healthCheck.mockImplementationOnce(() => new Promise((resolve) => { resolveHealth = resolve; }));
      const bindings = await createProductionApiPlatformBindings(fixture.value);
      const checking = bindings.databaseCompatibility.assertCompatible(new AbortController().signal);
      await vi.advanceTimersByTimeAsync(configuration.databaseHealthProbe.timeoutMs);
      await checking;
      expect(bindings.readiness()[0]).toMatchObject({ healthy: false });
      await vi.advanceTimersByTimeAsync(configuration.databaseHealthProbe.intervalMs * 2);
      expect(fixture.healthCheck).toHaveBeenCalledOnce();

      resolveHealth?.({ latencyMs: 1, status: "ready" });
      await Promise.resolve();
      expect(bindings.readiness()[0]).toMatchObject({ healthy: false });
      await vi.advanceTimersByTimeAsync(configuration.databaseHealthProbe.intervalMs);
      expect(fixture.healthCheck).toHaveBeenCalledTimes(2);
      await bindings.close?.();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not start or schedule a database probe after startup is aborted", async () => {
    const fixture = dependencies();
    const bindings = await createProductionApiPlatformBindings(fixture.value);
    const controller = new AbortController();
    const checking = bindings.databaseCompatibility.assertCompatible(controller.signal);
    controller.abort();
    await expect(checking).rejects.toThrow("api_start_cancelled");
    expect(bindings.readiness()[0]).toMatchObject({ healthy: false });
    expect(fixture.healthCheck).not.toHaveBeenCalled();
    await bindings.close?.();
  });

  it("invalidates readiness when startup is aborted after dependency probes begin", async () => {
    vi.useFakeTimers();
    try {
      const fixture = dependencies();
      let auditStarted = false;
      fixture.execute.mockImplementation((sql: string) => {
        if (sql.includes("has_schema_privilege(current_user, 'audit'")) {
          auditStarted = true;
          return new Promise(() => undefined);
        }
        if (sql.includes("from pg_catalog.pg_roles role")) {
          return Promise.resolve({ rowCount: 1, rows: [runtimeRoleCapabilities] });
        }
        return Promise.resolve({ rowCount: 0, rows: [] });
      });
      const bindings = await createProductionApiPlatformBindings(fixture.value);
      const controller = new AbortController();
      const checking = bindings.databaseCompatibility.assertCompatible(controller.signal);
      await vi.waitFor(() => { expect(auditStarted).toBe(true); });
      controller.abort();

      await expect(checking).rejects.toThrow("api_start_cancelled");
      expect(bindings.readiness().filter(({ name }) => name !== "session-store")
        .every(({ healthy }) => !healthy)).toBe(true);
      const healthCallsAtAbort = fixture.healthCheck.mock.calls.length;
      await vi.advanceTimersByTimeAsync(configuration.databaseHealthProbe.intervalMs * 2);
      expect(fixture.healthCheck).toHaveBeenCalledTimes(healthCallsAtAbort);
      await bindings.close?.();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not publish a slow policy result after close", async () => {
    const fixture = dependencies();
    let resolvePolicy: ((value: { rowCount: number; rows: readonly unknown[] }) => void) | undefined;
    fixture.execute.mockImplementation((sql: string) => sql.includes("authorization_core.current_policy")
      ? new Promise((resolve) => { resolvePolicy = resolve; })
      : Promise.resolve({ rowCount: 0, rows: [] }));
    const bindings = await createProductionApiPlatformBindings(fixture.value);
    const checking = bindings.databaseCompatibility.assertCompatible(new AbortController().signal);
    await vi.waitFor(() => { expect(resolvePolicy).toBeTypeOf("function"); });
    await bindings.close?.();
    resolvePolicy?.({ rowCount: 0, rows: [] });
    await expect(checking).rejects.toThrow("api_start_cancelled");
    expect(bindings.readiness().every(({ healthy }) => !healthy)).toBe(true);
  });

  it("does not start a new policy query after an audit probe is aborted", async () => {
    const fixture = dependencies();
    let auditStarted = false;
    let policyCalls = 0;
    fixture.execute.mockImplementation((sql: string) => {
      if (sql.includes("has_schema_privilege(current_user, 'audit'")) {
        auditStarted = true;
        return new Promise(() => undefined);
      }
      if (sql.includes("authorization_core.current_policy")) policyCalls += 1;
      return Promise.resolve({ rowCount: 0, rows: [] });
    });
    const bindings = await createProductionApiPlatformBindings(fixture.value);
    const checking = bindings.databaseCompatibility.assertCompatible(new AbortController().signal);
    await vi.waitFor(() => { expect(auditStarted).toBe(true); });
    const callsBeforeClose = policyCalls;
    await bindings.close?.();
    await expect(checking).rejects.toThrow("api_start_cancelled");
    expect(policyCalls).toBe(callsBeforeClose);
  });

  it("continues database and independent module probes while an audit dependency query remains stuck", async () => {
    vi.useFakeTimers();
    try {
      const fixture = dependencies();
      let registryProbeCalls = 0;
      let auditProbeCalls = 0;
      let resolveAudit: ((value: { readonly rowCount: number; readonly rows: readonly unknown[] }) => void) | undefined;
      fixture.execute.mockImplementation((sql: string) => {
        if (sql.includes("has_schema_privilege(current_user, 'audit'")) {
          auditProbeCalls += 1;
          return auditProbeCalls === 1
            ? new Promise((resolve) => { resolveAudit = resolve; })
            : Promise.resolve({ rowCount: 1, rows: [auditCapabilities] });
        }
        if (sql.includes("from pg_catalog.pg_roles role")) {
          return Promise.resolve({ rowCount: 1, rows: [runtimeRoleCapabilities] });
        }
        if (sql.includes("to_regclass('app_registry.applications')")) {
          registryProbeCalls += 1;
          return Promise.resolve({ rowCount: 1, rows: [applicationRegistryCapabilities] });
        }
        return Promise.resolve({ rowCount: 0, rows: [] });
      });
      const bindings = await createProductionApiPlatformBindings(fixture.value);
      const checking = bindings.databaseCompatibility.assertCompatible(new AbortController().signal);
      await vi.advanceTimersByTimeAsync(configuration.databaseHealthProbe.timeoutMs);
      await checking;
      expect(bindings.readiness()[4]).toMatchObject({ healthy: false });
      expect(bindings.readiness()[5]).toMatchObject({ healthy: true });

      await vi.advanceTimersByTimeAsync(configuration.databaseHealthProbe.intervalMs * 2);
      expect(fixture.healthCheck.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(registryProbeCalls).toBeGreaterThanOrEqual(3);
      expect(auditProbeCalls).toBe(1);

      resolveAudit?.({ rowCount: 0, rows: [] });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(configuration.databaseHealthProbe.intervalMs);
      expect(auditProbeCalls).toBe(2);
      expect(bindings.readiness()[4]).toMatchObject({ healthy: true });
      await bindings.close?.();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not publish a slow policy result from an obsolete probe generation", async () => {
    const fixture = dependencies();
    let currentPolicyCalls = 0;
    let resolveFirstPolicy: ((value: { rowCount: number; rows: readonly unknown[] }) => void) | undefined;
    fixture.execute.mockImplementation((sql: string) => {
      if (!sql.includes("authorization_core.current_policy")) return Promise.resolve({ rowCount: 0, rows: [] });
      currentPolicyCalls += 1;
      return currentPolicyCalls === 1
        ? new Promise((resolve) => { resolveFirstPolicy = resolve; })
        : Promise.resolve({ rowCount: 0, rows: [] });
    });
    const bindings = await createProductionApiPlatformBindings(fixture.value);
    const obsolete = bindings.databaseCompatibility.assertCompatible(new AbortController().signal);
    await vi.waitFor(() => { expect(resolveFirstPolicy).toBeTypeOf("function"); });
    await bindings.databaseCompatibility.assertCompatible(new AbortController().signal);
    resolveFirstPolicy?.({ rowCount: 0, rows: [] });
    await expect(obsolete).rejects.toThrow("api_start_cancelled");
    expect(bindings.readiness()[3]).toMatchObject({ healthy: false });
    await bindings.close?.();
  });

  it("invalidates a running background probe before closing database resources", async () => {
    vi.useFakeTimers();
    try {
      const fixture = dependencies();
      const bindings = await createProductionApiPlatformBindings(fixture.value);
      await bindings.databaseCompatibility.assertCompatible(new AbortController().signal);
      let resolveHealth: ((value: { latencyMs: number; status: "ready" }) => void) | undefined;
      fixture.healthCheck.mockImplementationOnce(() => new Promise((resolve) => { resolveHealth = resolve; }));
      await vi.advanceTimersByTimeAsync(configuration.databaseHealthProbe.intervalMs);
      expect(fixture.healthCheck).toHaveBeenCalledTimes(2);

      await bindings.close?.();
      resolveHealth?.({ latencyMs: 1, status: "ready" });
      await Promise.resolve();
      expect(bindings.readiness()[0]).toMatchObject({ healthy: false });
      await vi.advanceTimersByTimeAsync(configuration.databaseHealthProbe.intervalMs * 2);
      expect(fixture.healthCheck).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes resources already acquired when later production initialization fails", async () => {
    const fixture = dependencies();
    const failingDependencies: ProductionApiBindingDependencies = {
      ...fixture.value,
      createOidc: vi.fn(() => Promise.reject(new Error("identity unavailable"))),
    };
    await expect(createProductionApiPlatformBindings(failingDependencies)).rejects.toThrow("identity unavailable");
    expect(fixture.closeSessions).toHaveBeenCalledOnce();
    expect(fixture.closeDatabase).toHaveBeenCalledOnce();
  });

  it("preserves initialization and cleanup failures", async () => {
    const fixture = dependencies();
    fixture.closeSessions.mockRejectedValueOnce(new Error("close failed"));
    const failingDependencies: ProductionApiBindingDependencies = {
      ...fixture.value,
      createOidc: vi.fn(() => Promise.reject(new Error("identity unavailable"))),
    };
    await expect(createProductionApiPlatformBindings(failingDependencies, new AbortController().signal, 20))
      .rejects.toThrow("api_production_initialization_cleanup_failed");
  });

  it("bounds cleanup that never settles", async () => {
    const fixture = dependencies();
    fixture.closeSessions.mockImplementationOnce(() => new Promise<void>(() => undefined));
    const failingDependencies: ProductionApiBindingDependencies = {
      ...fixture.value,
      createOidc: vi.fn(() => Promise.reject(new Error("identity unavailable"))),
    };
    await expect(createProductionApiPlatformBindings(failingDependencies, new AbortController().signal, 10))
      .rejects.toThrow("api_production_initialization_cleanup_failed");
  });

  it("validates the token verifier before acquiring stateful resources", async () => {
    const fixture = dependencies();
    const invalidDependencies: ProductionApiBindingDependencies = {
      ...fixture.value,
      createTokenVerifier: vi.fn(() => { throw new Error("invalid verifier"); }),
    };
    await expect(createProductionApiPlatformBindings(invalidDependencies)).rejects.toThrow("invalid verifier");
    expect(fixture.value.createDatabase).not.toHaveBeenCalled();
    expect(fixture.value.connectSessions).not.toHaveBeenCalled();
  });
});
