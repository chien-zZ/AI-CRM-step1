import "reflect-metadata";
import { Module, type INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { ApplicationLogger } from "@ai-crm/observability";
import type { WorkerHealthReporter, WorkerHealthStatus } from "./health-file.js";

export const applicationId = "@ai-crm/worker" as const;
export { bootstrapWorker, type WorkerBootstrapOptions } from "./bootstrap.js";
export { defaultWorkerHealthFile, loadWorkerRuntimeConfiguration, type WorkerRuntimeConfiguration } from "./runtime-config.js";
export { createFileWorkerHealthReporter, type WorkerHealthReporter, type WorkerHealthStatus } from "./health-file.js";
export { createWorkerHandlerRegistry, type WorkerHandlerRegistry } from "./handler-registry.js";
export { loadRabbitConnectionConfiguration, type RabbitAccountRole, type RabbitConnectionConfiguration, type RabbitSecretFileAccess } from "./rabbit-config.js";
export { approvedWorkerMigrationRoots, loadProductionWorkerConfiguration, validateWorkerMigrationRootManifest, type LoadProductionWorkerConfigurationOptions, type ProductionWorkerConfiguration } from "./production-config.js";
export { createDefaultProductionWorkerResources, createProductionWorkerResources, type ProductionWorkerResourceDependencies, type ProductionWorkerResources } from "./production-composition.js";
export { createAmqplibConsumerAdapter, createAmqplibPublisherAdapter, createAmqplibResourceRuntime, type AbortableRabbitConsumerAdapter, type AmqplibConnector, type RabbitConsumerTopology, type RabbitPublisherAdapter, type RabbitResourceRuntime, type RabbitRetryLayer } from "./rabbit-adapter.js";
export { classifyTaskProjectionError, taskProjectionBindingId, taskProjectionConsumerId, taskProjectionRabbitTopology, taskProjectionRuntimePolicy } from "./task-projection-policy.js";
export { createTaskProjectionConsumerHandler, createTaskProjectionMessageHandler, type AbortableTaskProjectionApplyPort } from "./task-projection-composition.js";
export { loadFileProviderConfiguration, type FileProviderConfiguration } from "./file-provider-config.js";
export { createTencentCosStorageAdapter, TencentCosStorageAdapter, type CosClient, type CosStorageAdapterOptions } from "./cos-storage-adapter.js";
export { ClamAvMalwareScanner, type ClamAvScannerOptions } from "./clamav-scanner.js";
export {
  createFileMaintenanceHandler,
  createNotificationIntentHandler,
  createOutboxPublisherLoopHandler,
  createRabbitInboxHandler,
  createTaskReconciliationHandler,
  type FileMaintenanceSource,
  type NotificationIntentSource,
  type RabbitConsumerAdapter,
  type RabbitInboxBinding,
  type TaskReconciliationSource,
} from "./handlers.js";

@Module({})
// Nest requires a class as the application-context module token.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class WorkerModule {}

export interface WorkerDependency {
  readonly name: string;
  readonly required: boolean;
  readonly healthy: boolean;
}

export interface WorkerHandler {
  readonly name: string;
  readonly ready: (signal: AbortSignal) => void | Promise<void>;
  readonly run: (signal: AbortSignal) => void | Promise<void>;
  readonly stop?: () => void | Promise<void>;
}

export interface WorkerComposition {
  readonly dependencies?: () => readonly WorkerDependency[];
  readonly drainTimeoutMs?: number;
  readonly handlers?: readonly WorkerHandler[];
  readonly healthRefreshIntervalMs?: number;
  readonly healthReporter?: WorkerHealthReporter;
  readonly logger: ApplicationLogger;
  readonly onStart?: (signal: AbortSignal) => void | Promise<void>;
  readonly onStop?: () => void | Promise<void>;
  readonly startupTimeoutMs?: number;
  readonly requireHandlers?: boolean;
}

export interface WorkerApplication {
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly isDraining: () => boolean;
  readonly health: () => { readonly status: "ok" | "unavailable" };
  readonly waitForExit: () => Promise<0 | 1>;
}

const STABLE_HANDLER_ID = /^[a-z][a-z0-9._-]{0,127}$/u;

function validateHandlers(handlers: readonly WorkerHandler[], required: boolean): readonly WorkerHandler[] {
  if (required && handlers.length === 0) throw new Error("worker_handlers_required");
  const names = new Set<string>();
  for (const handler of handlers) {
    if (!STABLE_HANDLER_ID.test(handler.name) || names.has(handler.name)) throw new Error("worker_handler_id_invalid");
    names.add(handler.name);
  }
  return handlers;
}

type TimedResult<T> = { readonly kind: "completed"; readonly value: T } | { readonly kind: "timeout" };
async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<TimedResult<T>> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then((value) => ({ kind: "completed" as const, value })),
      new Promise<{ readonly kind: "timeout" }>((resolve) => { timeout = setTimeout(() => { resolve({ kind: "timeout" }); }, timeoutMs); }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function startupCancelled(signal: AbortSignal): boolean {
  return signal.aborted;
}

export const createWorkerApplication = (composition: WorkerComposition): WorkerApplication => {
  // Validate telemetry dimensions before any health or lifecycle event can be written.
  const handlers = validateHandlers(composition.handlers ?? [], composition.requireHandlers === true);
  const refreshIntervalMs = composition.healthRefreshIntervalMs ?? 10_000;
  const drainTimeoutMs = composition.drainTimeoutMs ?? 30_000;
  const startupTimeoutMs = composition.startupTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(refreshIntervalMs) || refreshIntervalMs < 1_000 || refreshIntervalMs > 60_000) {
    throw new Error("worker_health_interval_invalid");
  }
  if (!Number.isSafeInteger(drainTimeoutMs) || drainTimeoutMs < 1 || drainTimeoutMs > 300_000) throw new Error("worker_drain_timeout_invalid");
  if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 1 || startupTimeoutMs > 300_000) throw new Error("worker_startup_timeout_invalid");
  let running = false;
  let draining = false;
  let failed = false;
  let terminal = false;
  let activeStart = 0;
  let stopPromise: Promise<void> | undefined;
  let startPromise: Promise<void> | undefined;
  let application: INestApplicationContext | undefined;
  let healthTimer: NodeJS.Timeout | undefined;
  let controller = new AbortController();
  let activeInFlight = new Set<Promise<void>>();
  let fatalShutdown: Promise<void> | undefined;
  let resolveExit: ((code: 0 | 1) => void) | undefined;
  const exit = new Promise<0 | 1>((resolve) => { resolveExit = resolve; });
  let exitSettled = false;
  const log = (...input: Parameters<ApplicationLogger["log"]>): void => {
    try { composition.logger.log(...input); } catch { /* Technical telemetry cannot change Worker correctness. */ }
  };
  const settleExit = (code: 0 | 1): void => {
    if (exitSettled) return;
    exitSettled = true;
    resolveExit?.(code);
  };
  const triggerFatal = (errorCode: "worker_dependency_lost" | "worker_handler_failed" | "worker_handler_stopped" | "worker_health_report_failed", handler?: string): void => {
    if (!running || draining || fatalShutdown) return;
    failed = true;
    terminal = true;
    reportHealth("unavailable");
    log("error", { errorCode, ...(handler === undefined ? {} : { fields: { handler } }), operation: errorCode === "worker_health_report_failed" ? "worker.health.report" : handler === undefined ? "worker.health.dependencies" : "worker.handler.run", outcome: "failed" });
    fatalShutdown = stop().then(() => { settleExit(1); }, () => { settleExit(1); });
  };
  const dependenciesReady = (): boolean => {
    try {
      return composition.dependencies?.().every((item) => !item.required || item.healthy) !== false;
    } catch {
      log("error", { errorCode: "worker_dependency_check_failed", operation: "worker.health.dependencies", outcome: "failed" });
      return false;
    }
  };
  const stopFromSignal = (): void => {
    void stop().then(() => { settleExit(0); }, () => { settleExit(1); });
  };
  const removeSignalListeners = (): void => {
    process.off("SIGTERM", stopFromSignal);
    process.off("SIGINT", stopFromSignal);
  };
  const health = () => ({ status: running && !draining && !failed && dependenciesReady() ? "ok" as const : "unavailable" as const });
  const reportHealth = (status: WorkerHealthStatus): boolean => {
    try {
      composition.healthReporter?.report(status);
      return true;
    } catch {
      failed = true;
      try { composition.healthReporter?.report("unavailable"); } catch { /* The failed reporter cannot prove readiness. */ }
      log("error", { errorCode: "worker_health_report_failed", operation: "worker.health.report", outcome: "failed" });
      return false;
    }
  };
  const cleanupFailedStart = async (handlers: readonly WorkerHandler[], attemptInFlight: ReadonlySet<Promise<void>>): Promise<void> => {
    draining = true;
    running = false;
    controller.abort();
    if (healthTimer) clearInterval(healthTimer);
    healthTimer = undefined;
    reportHealth("unavailable");
    const startupApplication = application;
    application = undefined;
    const executionDrain = Promise.allSettled([...attemptInFlight]);
    const resourceCleanup = Promise.allSettled([
      ...handlers.map(async (handler) => { await handler.stop?.(); }),
      composition.onStop?.(),
      startupApplication?.close(),
    ]);
    const cleanup = Promise.all([executionDrain, resourceCleanup]);
    const cleanupResult = await settleWithin(cleanup, drainTimeoutMs);
    if (cleanupResult.kind === "timeout" || cleanupResult.value[1].some((result) => result.status === "rejected")) terminal = true;
    removeSignalListeners();
    draining = false;
  };
  const start = async (): Promise<void> => {
    if (stopPromise) await stopPromise;
    if (running) return;
    if (startPromise) return startPromise;
    if (!reportHealth("unavailable")) throw new Error("worker_health_report_failed");
    if (terminal) throw new Error("worker_terminal");
    if (!dependenciesReady()) throw new Error("worker_not_ready");
    startPromise = (async () => {
      const startId = ++activeStart;
      const attemptController = new AbortController();
      controller = attemptController;
      failed = false;
      const attemptInFlight = new Set<Promise<void>>();
      activeInFlight = attemptInFlight;
      const startupTerminations: Promise<"handler_stopped">[] = [];
      process.once("SIGTERM", stopFromSignal);
      process.once("SIGINT", stopFromSignal);
      try {
        const initialize = (async (): Promise<void> => {
          const candidate = await NestFactory.createApplicationContext(WorkerModule, { abortOnError: false, logger: false });
          if (attemptController.signal.aborted || startId !== activeStart) {
            await candidate.close();
            throw new Error("worker_start_cancelled");
          }
          application = candidate;
          log("info", { operation: "worker.lifecycle.start", outcome: "started" });
          await composition.onStart?.(attemptController.signal);
          if (startupCancelled(attemptController.signal) || startId !== activeStart) throw new Error("worker_start_cancelled");
          await Promise.all(handlers.map(async (handler) => { await handler.ready(attemptController.signal); }));
          if (startupCancelled(attemptController.signal) || startId !== activeStart) throw new Error("worker_start_cancelled");
          if (!dependenciesReady()) throw new Error("worker_not_ready");
          for (const handler of handlers) {
            const execution = Promise.resolve().then(async () => { await handler.run(attemptController.signal); }).finally(() => { attemptInFlight.delete(execution); });
            attemptInFlight.add(execution);
            startupTerminations.push(execution.then(() => "handler_stopped" as const, () => "handler_stopped" as const));
            void execution.then(
              () => {
                if (startId === activeStart) triggerFatal("worker_handler_stopped", handler.name);
              },
              () => {
                if (startId === activeStart) triggerFatal("worker_handler_failed", handler.name);
              },
            );
          }
          const ready = new Promise<"ready">((resolve) => { setImmediate(() => { resolve("ready"); }); });
          const startupOutcome = startupTerminations.length === 0 ? await ready : await Promise.race([...startupTerminations, ready]);
          if (startupOutcome !== "ready" || startupCancelled(attemptController.signal) || startId !== activeStart) throw new Error("worker_handler_start_failed");
        })();
        const initializeResult = await settleWithin(initialize, startupTimeoutMs);
        if (initializeResult.kind === "timeout") {
          attemptController.abort();
          if (startId === activeStart) activeStart += 1;
          throw new Error("worker_start_timeout");
        }
        running = true;
        if (health().status !== "ok") throw new Error("worker_not_ready");
        if (!reportHealth("ok")) throw new Error("worker_health_report_failed");
        healthTimer = setInterval(() => {
          if (!dependenciesReady()) triggerFatal("worker_dependency_lost");
          else if (!reportHealth(health().status)) triggerFatal("worker_health_report_failed");
        }, refreshIntervalMs);
        healthTimer.unref();
        log("info", { operation: "worker.lifecycle.start", outcome: "succeeded" });
      } catch (error) {
        if (startId === activeStart) activeStart += 1;
        await cleanupFailedStart(handlers, attemptInFlight);
        log("error", { errorCode: "worker_start_failed", operation: "worker.lifecycle.start", outcome: "failed" });
        throw error;
      }
    })().finally(() => { startPromise = undefined; });
    return startPromise;
  };
  const stop = async (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      activeStart += 1;
      if (startPromise) {
        controller.abort();
        const startupResult = await settleWithin(startPromise.then(() => undefined, () => undefined), startupTimeoutMs);
        if (startupResult.kind === "timeout") throw new Error("worker_start_stop_timeout");
      }
      if (!running && !draining) return;
      draining = true; running = false; controller.abort();
      if (healthTimer) clearInterval(healthTimer);
      healthTimer = undefined;
      reportHealth("unavailable");
      const stoppingApplication = application;
      application = undefined;
      const cleanupBudgetMs = Math.min(5_000, Math.floor(drainTimeoutMs / 4));
      const workloadBudgetMs = drainTimeoutMs - cleanupBudgetMs;
      const stoppingInFlight = activeInFlight;
      activeInFlight = new Set<Promise<void>>();
      const workload = (async (): Promise<readonly PromiseSettledResult<unknown>[]> => {
        const handlerStops = await Promise.allSettled(handlers.map(async (handler) => { await handler.stop?.(); }));
        await Promise.allSettled([...stoppingInFlight]);
        return handlerStops;
      })();
      try {
        const workloadResult = await settleWithin(workload, workloadBudgetMs);
        const lifecycleResult = await settleWithin(Promise.allSettled([composition.onStop?.(), stoppingApplication?.close()]), cleanupBudgetMs);
        if (workloadResult.kind === "timeout" || lifecycleResult.kind === "timeout") throw new Error("worker_drain_timeout");
        if ([...workloadResult.value, ...lifecycleResult.value].some((result) => result.status === "rejected")) throw new Error("worker_stop_failed");
        log("info", { operation: "worker.lifecycle.stop", outcome: "succeeded" });
      } catch (error) {
        terminal = true;
        log("error", { errorCode: error instanceof Error && error.message === "worker_drain_timeout" ? "worker_drain_timeout" : "worker_stop_failed", operation: "worker.lifecycle.stop", outcome: "failed" });
        throw error;
      } finally {
        removeSignalListeners();
        draining = false;
      }
    })().finally(() => { stopPromise = undefined; });
    return stopPromise;
  };
  return { start, stop, isDraining: () => draining, health, waitForExit: () => exit };
};
