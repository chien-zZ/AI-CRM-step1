import { describe, expect, it, vi } from "vitest";
import type { DatabaseRuntime } from "@ai-crm/database";
import {
  createProductionWorkerResources,
  taskProjectionConsumerPolicyUnavailable,
  type ProductionWorkerResourceDependencies,
} from "./production-composition.js";
import type { ProductionWorkerConfiguration } from "./production-config.js";
import type { RabbitPublisherAdapter, RabbitResourceRuntime } from "./rabbit-adapter.js";

function deferred<T>(): { readonly promise: Promise<T>; readonly reject: (error: Error) => void; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  return { promise: new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; }), reject, resolve };
}

const rabbitConfiguration = Object.freeze({
  ca: Buffer.from("synthetic"), heartbeatSeconds: 30, hostname: "rabbit.internal", password: "secret", port: 5671,
  servername: "rabbit.internal", tls: true as const, username: "worker", vhost: "ai-crm-test",
});

const configuration = (overrides: Partial<ProductionWorkerConfiguration> = {}): Readonly<ProductionWorkerConfiguration> => Object.freeze({
  applicationSchemaVersion: "0.0.0",
  database: Object.freeze({ applicationName: "ai_crm_worker", connectionString: "postgresql://worker:secret@db/ai_crm", connectionTimeoutMs: 100, idleTimeoutMs: 1000, maxConnections: 1, statementTimeoutMs: 100 }),
  databaseCompatibilityTimeoutMs: 100,
  databaseHealthProbe: Object.freeze({ intervalMs: 1_000, timeoutMs: 100 }),
  migrations: Object.freeze(["D:\\AI-CRM\\packages\\database\\migrations"]),
  rabbit: Object.freeze({ acquisitionTimeoutMs: 100, consumer: rabbitConfiguration, publisher: rabbitConfiguration }),
  ...overrides,
});

function fixture(options: {
  readonly compatibility?: ReturnType<ProductionWorkerResourceDependencies["checkCompatibility"]>;
  readonly consumer?: Promise<RabbitResourceRuntime>;
  readonly health?: () => Promise<{ readonly latencyMs: number; readonly status: "ready" | "unavailable" }>;
  readonly publisher?: Promise<RabbitPublisherAdapter>;
  readonly reportCompatible?: boolean;
} = {}) {
  const closeDatabase = vi.fn(() => Promise.resolve());
  const closePublisher = vi.fn(() => Promise.resolve());
  const closeConsumer = vi.fn(() => Promise.resolve());
  const publisherHealthy = vi.fn(() => true);
  const consumerHealthy = vi.fn(() => true);
  const publisherSignals: AbortSignal[] = [];
  const database: DatabaseRuntime = {
    close: closeDatabase,
    execute: vi.fn(() => Promise.resolve({ rowCount: 0, rows: [] })),
    healthCheck: vi.fn(options.health ?? (() => Promise.resolve({ latencyMs: 1, status: "ready" as const }))),
    withTransaction: <T>(work: () => Promise<T>): Promise<T> => work(),
  };
  const publisher: RabbitPublisherAdapter = { channel: {} as RabbitPublisherAdapter["channel"], close: closePublisher, healthy: publisherHealthy };
  const consumer: RabbitResourceRuntime = { close: closeConsumer, healthy: consumerHealthy };
  const dependencies: ProductionWorkerResourceDependencies = {
    checkCompatibility: vi.fn(() => options.compatibility ?? Promise.resolve({ applicationSchemaVersion: "0.0.0", compatible: options.reportCompatible ?? true, currentMigrationVersion: "0000000012", issues: [] })),
    createConsumerResource: vi.fn(() => options.consumer ?? Promise.resolve(consumer)),
    createDatabase: vi.fn(() => database),
    createPublisherResource: vi.fn((_configuration: ProductionWorkerConfiguration["rabbit"]["publisher"], signal: AbortSignal) => {
      publisherSignals.push(signal);
      return options.publisher ?? Promise.resolve(publisher);
    }),
    loadConfiguration: vi.fn(() => Promise.resolve(configuration())),
  };
  return { closeConsumer, closeDatabase, closePublisher, consumerHealthy, database, dependencies, publisherHealthy, publisherSignals };
}

describe("generic production Worker resources", () => {
  it("checks every configured migration read-only, caches DB health, but keeps Task projection unavailable", async () => {
    const value = fixture();
    const resources = await createProductionWorkerResources(value.dependencies);
    await resources.assertDatabaseCompatible(new AbortController().signal);
    expect(value.dependencies.checkCompatibility).toHaveBeenCalledWith(expect.anything(), configuration().migrations, "0.0.0");
    expect(resources.readiness()).toEqual([
      { healthy: true, name: "application-database", required: true },
      { healthy: true, name: "rabbitmq-publisher", required: true },
      { healthy: true, name: "rabbitmq-consumer-control", required: true },
      { healthy: false, name: taskProjectionConsumerPolicyUnavailable, required: true },
    ]);
    expect(() => resources.assertTaskProjectionConsumerPolicyAvailable()).toThrow(taskProjectionConsumerPolicyUnavailable);
    await resources.close();
    expect([value.closeConsumer.mock.calls.length, value.closePublisher.mock.calls.length, value.closeDatabase.mock.calls.length]).toEqual([1, 1, 1]);
  });

  it("does not publish DB readiness for an incompatible migration catalog", async () => {
    const value = fixture({ reportCompatible: false });
    const resources = await createProductionWorkerResources(value.dependencies);
    await expect(resources.assertDatabaseCompatible(new AbortController().signal)).rejects.toThrow("worker_database_migration_incompatible");
    expect(resources.readiness()[0]?.healthy).toBe(false);
    await resources.close();
  });

  it("maps runtime DB loss and Rabbit blocked/channel-close state into readiness", async () => {
    let healthCalls = 0;
    const value = fixture({ health: () => Promise.resolve({ latencyMs: 1, status: ++healthCalls === 1 ? "ready" : "unavailable" }) });
    vi.useFakeTimers();
    let resources: Awaited<ReturnType<typeof createProductionWorkerResources>> | undefined;
    try {
      resources = await createProductionWorkerResources(value.dependencies);
      await resources.assertDatabaseCompatible(new AbortController().signal);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(resources.readiness()[0]?.healthy).toBe(false);
      value.publisherHealthy.mockReturnValue(false);
      value.consumerHealthy.mockReturnValue(false);
      expect(resources.readiness().slice(1, 3).map((item) => item.healthy)).toEqual([false, false]);
    } finally {
      await resources?.close();
      vi.useRealTimers();
    }
  });

  it("closes already acquired resources when the consumer control connection fails", async () => {
    const value = fixture({ consumer: Promise.reject(new Error("consumer unavailable")) });
    await expect(createProductionWorkerResources(value.dependencies)).rejects.toThrow("consumer unavailable");
    expect(value.closePublisher).toHaveBeenCalledOnce();
    expect(value.closeDatabase).toHaveBeenCalledOnce();
  });

  it("closes a Rabbit resource that completes after its bounded acquisition deadline", async () => {
    vi.useFakeTimers();
    try {
      const late = deferred<RabbitPublisherAdapter>();
      const value = fixture({ publisher: late.promise });
      const creation = createProductionWorkerResources(value.dependencies);
      const outcome = creation.then(() => undefined, (error: unknown) => error);
      await vi.advanceTimersByTimeAsync(100);
      await expect(outcome).resolves.toEqual(expect.objectContaining({ message: "worker_rabbit_acquisition_cancelled" }));
      const acquisitionSignal = value.publisherSignals[0];
      expect(acquisitionSignal?.aborted).toBe(true);
      late.resolve({ channel: {} as RabbitPublisherAdapter["channel"], close: value.closePublisher, healthy: () => true });
      await vi.runAllTimersAsync();
      expect(value.closePublisher).toHaveBeenCalledOnce();
      expect(value.closeDatabase).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it("aborts acquisition and closes a late resource without activating any consumer", async () => {
    const late = deferred<RabbitPublisherAdapter>();
    const value = fixture({ publisher: late.promise });
    const controller = new AbortController();
    const creation = createProductionWorkerResources(value.dependencies, controller.signal);
    await vi.waitFor(() => { expect(value.dependencies.createPublisherResource).toHaveBeenCalledOnce(); });
    controller.abort();
    await expect(creation).rejects.toThrow("worker_rabbit_acquisition_cancelled");
    late.resolve({ channel: {} as RabbitPublisherAdapter["channel"], close: value.closePublisher, healthy: () => true });
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    expect(value.closePublisher).toHaveBeenCalledOnce();
    expect(value.dependencies.createConsumerResource).not.toHaveBeenCalled();
  });

  it("bounds close and reports both deadline and resource failures", async () => {
    vi.useFakeTimers();
    try {
      const stuck = fixture();
      const releaseClose = deferred<undefined>();
      stuck.closeConsumer.mockImplementationOnce(async () => { await releaseClose.promise; });
      const resources = await createProductionWorkerResources(stuck.dependencies, new AbortController().signal, 10);
      const closing = resources.close().then(() => undefined, (error: unknown) => error);
      await vi.advanceTimersByTimeAsync(10);
      await expect(closing).resolves.toEqual(expect.objectContaining({ message: "worker_production_resource_close_timeout" }));
      const retry = resources.close();
      expect(stuck.closeConsumer).toHaveBeenCalledOnce();
      releaseClose.resolve(undefined);
      await retry;
      expect([stuck.closeConsumer.mock.calls.length, stuck.closePublisher.mock.calls.length, stuck.closeDatabase.mock.calls.length]).toEqual([1, 1, 1]);
    } finally { vi.useRealTimers(); }

    const failed = fixture();
    failed.closePublisher.mockRejectedValueOnce(new Error("close failed"));
    const resources = await createProductionWorkerResources(failed.dependencies);
    await expect(resources.close()).rejects.toThrow("worker_production_resource_close_failed");
    await expect(resources.close()).resolves.toBeUndefined();
    expect(failed.closePublisher).toHaveBeenCalledTimes(2);
    expect(failed.closeConsumer).toHaveBeenCalledOnce();
    expect(failed.closeDatabase).toHaveBeenCalledOnce();
  });

  it("ignores late compatibility completion after close", async () => {
    const compatibility = deferred<Awaited<ReturnType<ProductionWorkerResourceDependencies["checkCompatibility"]>>>();
    const value = fixture({ compatibility: compatibility.promise });
    const resources = await createProductionWorkerResources(value.dependencies);
    const checking = resources.assertDatabaseCompatible(new AbortController().signal);
    await resources.close();
    compatibility.resolve({ applicationSchemaVersion: "0.0.0", compatible: true, currentMigrationVersion: "0000000012", issues: [] });
    await expect(checking).rejects.toThrow("worker_start_cancelled");
    expect(resources.readiness().every((item) => !item.healthy)).toBe(true);
  });
});
