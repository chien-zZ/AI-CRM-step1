import { Buffer } from "node:buffer";

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
  readonly value: ProductionApiBindingDependencies;
} {
  const closeDatabase = vi.fn(() => Promise.resolve());
  const closeSessions = vi.fn(() => Promise.resolve());
  return {
    closeDatabase,
    closeSessions,
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
        close: closeDatabase,
        execute: vi.fn(() => Promise.resolve({ rowCount: 0, rows: [] })),
        healthCheck: vi.fn(() => Promise.resolve({ latencyMs: 1, status: "ready" as const })),
        withTransaction: <T>(work: () => Promise<T>) => work(),
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

describe("production API platform binding factory", () => {
  it("checks migration compatibility, stays fail-closed for unresolved capabilities, and closes once", async () => {
    const fixture = dependencies();
    const bindings = await createProductionApiPlatformBindings(fixture.value);
    const signal = new AbortController().signal;

    expect(bindings.readiness()).toEqual([
      { healthy: false, name: "application-database", required: true },
      { healthy: true, name: "session-store", required: true },
      { healthy: false, name: "authorization-policy", required: true },
      { healthy: false, name: "authentication-audit", required: true },
    ]);
    await bindings.databaseCompatibility.assertCompatible(signal);
    expect(bindings.readiness()[0]).toMatchObject({ healthy: true });
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

  it("rejects an incompatible database without publishing database readiness", async () => {
    const fixture = dependencies(false);
    const bindings = await createProductionApiPlatformBindings(fixture.value);
    await expect(bindings.databaseCompatibility.assertCompatible(new AbortController().signal))
      .rejects.toThrow("api_database_migration_incompatible");
    expect(bindings.readiness()[0]).toMatchObject({ healthy: false });
    await bindings.close?.();
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
