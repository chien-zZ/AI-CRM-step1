import {
  checkMigrationCompatibility,
  createDatabaseRuntime,
  type DatabaseConfig,
  type DatabaseRuntime,
  type MigrationPool,
} from "@ai-crm/database";
import {
  createAmqplibPublisherAdapter,
  createAmqplibResourceRuntime,
  type RabbitPublisherAdapter,
  type RabbitResourceRuntime,
} from "./rabbit-adapter.js";
import { loadProductionWorkerConfiguration, type ProductionWorkerConfiguration } from "./production-config.js";
import type { WorkerDependency } from "./index.js";

export const taskProjectionConsumerPolicyUnavailable = "task_projection_consumer_policy_unavailable" as const;

export interface ProductionWorkerResources {
  readonly assertDatabaseCompatible: (signal: AbortSignal) => Promise<void>;
  readonly assertTaskProjectionConsumerPolicyAvailable: () => never;
  readonly close: () => Promise<void>;
  readonly readiness: () => readonly WorkerDependency[];
}

export interface ProductionWorkerResourceDependencies {
  readonly checkCompatibility: typeof checkMigrationCompatibility;
  readonly createConsumerResource: (configuration: ProductionWorkerConfiguration["rabbit"]["consumer"], signal: AbortSignal) => Promise<RabbitResourceRuntime>;
  readonly createDatabase: (configuration: DatabaseConfig) => DatabaseRuntime;
  readonly createPublisherResource: (configuration: ProductionWorkerConfiguration["rabbit"]["publisher"], signal: AbortSignal) => Promise<RabbitPublisherAdapter>;
  readonly loadConfiguration: () => Promise<Readonly<ProductionWorkerConfiguration>>;
}

const productionDependencies: ProductionWorkerResourceDependencies = Object.freeze({
  checkCompatibility: checkMigrationCompatibility,
  createConsumerResource: (configuration: ProductionWorkerConfiguration["rabbit"]["consumer"], signal: AbortSignal) =>
    createAmqplibResourceRuntime(configuration, undefined, signal),
  createDatabase: createDatabaseRuntime,
  createPublisherResource: (configuration: ProductionWorkerConfiguration["rabbit"]["publisher"], signal: AbortSignal) =>
    createAmqplibPublisherAdapter(configuration, undefined, signal),
  loadConfiguration: loadProductionWorkerConfiguration,
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

function bounded<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal, code: string): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error(code));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", aborted);
      action();
    };
    const aborted = (): void => { finish(() => { reject(new Error(code)); }); };
    const timer = setTimeout(() => { finish(() => { reject(new Error(code)); }); }, timeoutMs);
    timer.unref();
    signal.addEventListener("abort", aborted, { once: true });
    void promise.then(
      (value) => { finish(() => { resolve(value); }); },
      (error: unknown) => { finish(() => { reject(error instanceof Error ? error : new Error(code)); }); },
    );
  });
}

async function closeBounded(
  resources: readonly { readonly close: () => Promise<void> }[],
  timeoutMs: number,
  code: string,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const result = await Promise.race([
    Promise.allSettled(resources.map(async (resource) => { await resource.close(); })),
    new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => { resolve("timeout"); }, timeoutMs);
      timer.unref();
    }),
  ]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
  if (result === "timeout") throw new Error(`${code}_timeout`);
  if (result.some((item) => item.status === "rejected")) throw new Error(`${code}_failed`);
}

async function waitForCloseOperation(
  operation: Promise<readonly PromiseSettledResult<void>[]>,
  timeoutMs: number,
): Promise<readonly PromiseSettledResult<void>[] | "timeout"> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    operation,
    new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => { resolve("timeout"); }, timeoutMs);
      timer.unref();
    }),
  ]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
}

async function acquireRabbit<T extends { readonly close: (signal?: AbortSignal) => Promise<void> }>(
  acquireResource: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const aborted = (): void => { controller.abort(); };
  signal.addEventListener("abort", aborted, { once: true });
  if (signal.aborted) controller.abort();
  const acquire = acquireResource(controller.signal);
  try {
    return await bounded(acquire, timeoutMs, signal, "worker_rabbit_acquisition_cancelled");
  } catch (error) {
    controller.abort();
    // A connector can complete after the application-side deadline. Close that
    // late resource instead of allowing it to become an unowned connection.
    void acquire.then(async (resource) => {
      const controller = new AbortController();
      const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
      timer.unref();
      try { await resource.close(controller.signal); } catch { /* No owner remains to report telemetry safely. */ }
      finally { clearTimeout(timer); }
    }, () => undefined);
    throw error;
  } finally {
    signal.removeEventListener("abort", aborted);
  }
}

function boundedHealthCheck(
  database: DatabaseRuntime,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<Readonly<{ readonly completion: Promise<void>; readonly healthy: boolean }>> {
  if (signal.aborted) return Promise.resolve(Object.freeze({ completion: Promise.resolve(), healthy: false }));
  const probe = database.healthCheck();
  const completion = probe.then(() => undefined, () => undefined);
  return bounded(probe, timeoutMs, signal, "worker_database_health_probe_cancelled").then(
    (health) => Object.freeze({ completion, healthy: health.status === "ready" }),
    () => Object.freeze({ completion, healthy: false }),
  );
}

function startupAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

export async function createProductionWorkerResources(
  dependencies: ProductionWorkerResourceDependencies = productionDependencies,
  signal: AbortSignal = new AbortController().signal,
  cleanupTimeoutMs = 30_000,
): Promise<ProductionWorkerResources> {
  if (!Number.isSafeInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1 || cleanupTimeoutMs > 300_000) {
    throw new Error("worker_production_cleanup_timeout_invalid");
  }
  if (startupAborted(signal)) throw new Error("worker_start_cancelled");
  const configuration = await dependencies.loadConfiguration();
  if (startupAborted(signal)) throw new Error("worker_start_cancelled");
  const database = dependencies.createDatabase(configuration.database);
  let publisher: RabbitPublisherAdapter | undefined;
  let consumer: RabbitResourceRuntime | undefined;
  try {
    publisher = await acquireRabbit(
      (acquisitionSignal) => dependencies.createPublisherResource(configuration.rabbit.publisher, acquisitionSignal),
      configuration.rabbit.acquisitionTimeoutMs,
      signal,
    );
    consumer = await acquireRabbit(
      (acquisitionSignal) => dependencies.createConsumerResource(configuration.rabbit.consumer, acquisitionSignal),
      configuration.rabbit.acquisitionTimeoutMs,
      signal,
    );
    if (startupAborted(signal)) throw new Error("worker_start_cancelled");
  } catch (error) {
    const acquiredPublisher = publisher;
    const acquired = [
      ...(acquiredPublisher === undefined ? [] : [{ close: () => acquiredPublisher.close() }]),
      { close: () => database.close() },
    ];
    try { await closeBounded(acquired, cleanupTimeoutMs, "worker_production_initialization_cleanup"); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "worker_production_initialization_cleanup_failed"); }
    throw error;
  }
  const activePublisher = publisher;
  const activeConsumer = consumer;
  const state = { closed: false, databaseCompatible: false, databaseHealthy: false };
  let probeController = new AbortController();
  let probeGeneration = 0;
  let probeTimer: NodeJS.Timeout | undefined;
  let closeConfirmed = false;
  let closeOperation: Promise<readonly PromiseSettledResult<void>[]> | undefined;
  let closeTargets: Array<() => Promise<void>> = [
    () => activeConsumer.close(),
    () => activePublisher.close(),
    () => database.close(),
  ];

  const stopProbes = (): void => {
    probeGeneration += 1;
    probeController.abort();
    if (probeTimer !== undefined) clearTimeout(probeTimer);
    probeTimer = undefined;
    state.databaseHealthy = false;
  };
  const obsolete = (controller: AbortController, generation: number): boolean =>
    state.closed || controller.signal.aborted || generation !== probeGeneration;
  const scheduleProbe = (controller: AbortController, generation: number): void => {
    if (obsolete(controller, generation)) return;
    probeTimer = setTimeout(() => {
      probeTimer = undefined;
      void boundedHealthCheck(database, configuration.databaseHealthProbe.timeoutMs, controller.signal).then((result) => {
        if (obsolete(controller, generation)) return;
        state.databaseHealthy = result.healthy;
        void result.completion.then(() => { scheduleProbe(controller, generation); });
      });
    }, configuration.databaseHealthProbe.intervalMs);
    probeTimer.unref();
  };
  const assertActive = (activeSignal: AbortSignal): void => {
    if (state.closed || activeSignal.aborted) throw new Error("worker_start_cancelled");
  };

  return Object.freeze({
    async assertDatabaseCompatible(activeSignal: AbortSignal) {
      assertActive(activeSignal);
      state.databaseCompatible = false;
      const generation = ++probeGeneration;
      const compatibility = dependencies.checkCompatibility(
        migrationPool(database),
        configuration.migrations,
        configuration.applicationSchemaVersion,
      );
      const report = await bounded(
        compatibility,
        configuration.databaseCompatibilityTimeoutMs,
        activeSignal,
        "worker_database_compatibility_cancelled",
      );
      assertActive(activeSignal);
      if (generation !== probeGeneration) throw new Error("worker_start_cancelled");
      if (!report.compatible) throw new Error("worker_database_migration_incompatible");
      state.databaseCompatible = true;
      probeController.abort();
      probeController = new AbortController();
      const controller = probeController;
      const probe = await boundedHealthCheck(database, configuration.databaseHealthProbe.timeoutMs, activeSignal);
      assertActive(activeSignal);
      if (generation !== probeGeneration) throw new Error("worker_start_cancelled");
      state.databaseHealthy = probe.healthy;
      void probe.completion.then(() => { scheduleProbe(controller, generation); });
      if (!probe.healthy) throw new Error("worker_database_unavailable");
    },
    assertTaskProjectionConsumerPolicyAvailable() {
      throw new Error(taskProjectionConsumerPolicyUnavailable);
    },
    async close() {
      if (closeConfirmed) return;
      if (!state.closed) {
        state.closed = true;
        state.databaseCompatible = false;
        stopProbes();
      }
      const targets = closeTargets;
      closeOperation ??= Promise.allSettled(targets.map(async (close) => { await close(); }));
      const operation = closeOperation;
      const result = await waitForCloseOperation(operation, cleanupTimeoutMs);
      if (result === "timeout") throw new Error("worker_production_resource_close_timeout");
      const failedTargets = targets.filter((_target, index) => result[index]?.status === "rejected");
      if (failedTargets.length > 0) {
        if (closeOperation === operation) closeOperation = undefined;
        closeTargets = failedTargets;
        throw new Error("worker_production_resource_close_failed");
      }
      closeTargets = [];
      closeConfirmed = true;
      if (closeOperation === operation) closeOperation = undefined;
    },
    readiness: () => Object.freeze([
      { healthy: !state.closed && state.databaseCompatible && state.databaseHealthy, name: "application-database", required: true },
      { healthy: !state.closed && activePublisher.healthy(), name: "rabbitmq-publisher", required: true },
      { healthy: !state.closed && activeConsumer.healthy(), name: "rabbitmq-consumer-control", required: true },
      { healthy: false, name: taskProjectionConsumerPolicyUnavailable, required: true },
    ]),
  });
}

export function createDefaultProductionWorkerResources(
  signal: AbortSignal,
  cleanupTimeoutMs: number,
): Promise<ProductionWorkerResources> {
  return createProductionWorkerResources(productionDependencies, signal, cleanupTimeoutMs);
}
