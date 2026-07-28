import { describe, expect, it, vi } from "vitest";

import type { ApiPlatformBindings } from "./composition.js";
import { bootstrapApiProcess, type ApiProcessPort } from "./main.js";
import { runApiMain } from "./main.js";

class SyntheticProcess implements ApiProcessPort {
  exitCode: number | undefined;
  readonly listeners = new Map<"SIGINT" | "SIGTERM", () => void>();

  off(event: "SIGINT" | "SIGTERM", listener: () => void): void {
    if (this.listeners.get(event) === listener) this.listeners.delete(event);
  }

  once(event: "SIGINT" | "SIGTERM", listener: () => void): void {
    this.listeners.set(event, listener);
  }

  emit(event: "SIGINT" | "SIGTERM"): void {
    const listener = this.listeners.get(event);
    this.listeners.delete(event);
    listener?.();
  }
}

function bindings(): ApiPlatformBindings {
  return {
    audit: { readSensitive: vi.fn(), record: vi.fn() },
    authentication: { beginLogin: vi.fn(), completeLogin: vi.fn(), currentSession: vi.fn(), logout: vi.fn(), refresh: vi.fn() },
    authenticationCallbackUrl: (requestPathAndQuery) => `https://api.invalid${requestPathAndQuery}`,
    browserSecurity: { allowedOrigins: ["https://workbench.invalid"] },
    authorization: { requireAllowed: vi.fn() } as unknown as ApiPlatformBindings["authorization"],
    authorizationTrace: { run: async (_traceId, work) => work() },
    databaseCompatibility: { assertCompatible: vi.fn() },
    organization: { resolveWorkforceContext: vi.fn() } as unknown as ApiPlatformBindings["organization"],
    queries: {
      applicationRegistry: { loadRegistry: vi.fn(), resolveDeepLink: vi.fn() },
      fileCenter: { authorizeDownload: vi.fn(), completeUpload: vi.fn(), createUploadSession: vi.fn() },
      forms: { getRelease: vi.fn(), validateSubmission: vi.fn() },
      notifications: { get: vi.fn(), list: vi.fn(), unreadCount: vi.fn() },
      tasks: { get: vi.fn(), list: vi.fn() },
    },
    readiness: () => [],
    sessions: { resolvePrincipal: vi.fn(), sessionForMutation: vi.fn() },
  };
}

describe("API process bootstrap", () => {
  it("has a no-argument-style executable path for the business-neutral test composition", async () => {
    const processPort = new SyntheticProcess();
    const running = await runApiMain({
      configuration: { env: { AI_CRM_API_HOST: "127.0.0.1", AI_CRM_API_PORT: "0", NODE_ENV: "test" } },
      processPort,
    });
    expect(running.application.health("readiness")).toEqual({ status: "unavailable" });
    await running.shutdown();
  });

  it("fails production closed at the application-owned composition factory", async () => {
    await expect(runApiMain({ configuration: { env: {
      AI_CRM_INSTANCE_ID: "api-prod-1",
      AI_CRM_RELEASE: "2026.07.27.1",
      NODE_ENV: "production",
    } } })).rejects.toMatchObject({ code: "missing_value", variable: "AI_CRM_API_SCHEMA_VERSION" });
  });

  it("installs cancellation before binding acquisition and aborts it on SIGTERM", async () => {
    const processPort = new SyntheticProcess();
    let acquisitionStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { acquisitionStarted = resolve; });
    const creating = runApiMain({
      bindingFactory: {
        create: (_configuration, signal) => new Promise<ApiPlatformBindings>((_resolve, reject) => {
          acquisitionStarted?.();
          signal?.addEventListener("abort", () => { reject(new Error("api_start_cancelled")); }, { once: true });
        }),
      },
      configuration: { env: {
        AI_CRM_API_HOST: "127.0.0.1", AI_CRM_API_PORT: "0", AI_CRM_API_STARTUP_TIMEOUT_MS: "1000", NODE_ENV: "test",
      } },
      processPort,
    });
    await started;
    expect(processPort.listeners.size).toBe(2);
    processPort.emit("SIGTERM");
    await expect(creating).rejects.toThrow("api_start_cancelled");
    expect(processPort.exitCode).toBe(0);
    expect(processPort.listeners.size).toBe(0);
  });

  it("reports acquisition cleanup failure after SIGTERM as non-zero", async () => {
    const processPort = new SyntheticProcess();
    let acquisitionStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { acquisitionStarted = resolve; });
    const creating = runApiMain({
      bindingFactory: {
        create: (_configuration, signal) => new Promise<ApiPlatformBindings>((_resolve, reject) => {
          acquisitionStarted?.();
          signal?.addEventListener("abort", () => {
            reject(new AggregateError([], "api_production_initialization_cleanup_failed"));
          }, { once: true });
        }),
      },
      configuration: { env: {
        AI_CRM_API_HOST: "127.0.0.1", AI_CRM_API_PORT: "0", AI_CRM_API_STARTUP_TIMEOUT_MS: "1000", NODE_ENV: "test",
      } },
      processPort,
    });
    await started;
    processPort.emit("SIGINT");
    await expect(creating).rejects.toThrow("api_production_initialization_cleanup_failed");
    expect(processPort.exitCode).toBe(1);
  });

  it("classifies a binding acquisition deadline as startup timeout", async () => {
    const processPort = new SyntheticProcess();
    const creating = runApiMain({
      bindingFactory: {
        create: (_configuration, signal) => new Promise<ApiPlatformBindings>((_resolve, reject) => {
          signal?.addEventListener("abort", () => { reject(new Error("api_start_cancelled")); }, { once: true });
        }),
      },
      configuration: { env: {
        AI_CRM_API_HOST: "127.0.0.1", AI_CRM_API_PORT: "0", AI_CRM_API_STARTUP_TIMEOUT_MS: "1", NODE_ENV: "test",
      } },
      processPort,
    });
    await expect(creating).rejects.toThrow("api_start_timeout");
    expect(processPort.listeners.size).toBe(0);
  });

  it("checks compatibility and performs bounded signal shutdown", async () => {
    const configuredBindings = bindings();
    const processPort = new SyntheticProcess();
    const logger = { log: vi.fn() };
    const running = await bootstrapApiProcess({
      bindings: configuredBindings,
      configuration: {
        environment: "test",
        host: "127.0.0.1",
        instanceId: "api-test",
        port: 0,
        release: "synthetic",
        shutdownTimeoutMs: 100,
        startupTimeoutMs: 100,
      },
      logger,
      processPort,
    });
    expect(configuredBindings.databaseCompatibility.assertCompatible).toHaveBeenCalledOnce();
    expect(processPort.listeners.size).toBe(2);
    processPort.emit("SIGTERM");
    await vi.waitFor(() => { expect(processPort.exitCode).toBe(0); });
    expect(processPort.listeners.size).toBe(0);
    expect(running.application.health("readiness")).toEqual({ status: "unavailable" });
  });

  it("fails before listening when migration compatibility is not proven", async () => {
    const configuredBindings = {
      ...bindings(),
      databaseCompatibility: { assertCompatible: vi.fn(() => { throw new Error("migration_incompatible"); }) },
    };
    const processPort = new SyntheticProcess();
    await expect(bootstrapApiProcess({
      bindings: configuredBindings,
      configuration: {
        environment: "test",
        host: "127.0.0.1",
        instanceId: "api-test",
        port: 0,
        release: "synthetic",
        shutdownTimeoutMs: 100,
        startupTimeoutMs: 100,
      },
      logger: { log: vi.fn() },
      processPort,
    })).rejects.toThrow("migration_incompatible");
    expect(processPort.listeners.size).toBe(0);
  });

  it("handles SIGTERM while startup is still waiting", async () => {
    const processPort = new SyntheticProcess();
    let started: (() => void) | undefined;
    const compatibilityStarted = new Promise<void>((resolve) => { started = resolve; });
    const configuredBindings = {
      ...bindings(),
      databaseCompatibility: {
        assertCompatible: (signal: AbortSignal) => new Promise<void>((resolve) => {
          started?.();
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => { resolve(); }, { once: true });
        }),
      },
    };
    const bootstrapping = bootstrapApiProcess({
      bindings: configuredBindings,
      configuration: {
        environment: "test", host: "127.0.0.1", instanceId: "api-test", port: 0, release: "synthetic",
        shutdownTimeoutMs: 100, startupTimeoutMs: 100,
      },
      logger: { log: vi.fn() },
      processPort,
    });
    await compatibilityStarted;
    processPort.emit("SIGTERM");
    await expect(bootstrapping).rejects.toThrow("api_start_cancelled");
    await vi.waitFor(() => { expect(processPort.exitCode).toBe(0); });
    expect(processPort.listeners.size).toBe(0);
  });
});
