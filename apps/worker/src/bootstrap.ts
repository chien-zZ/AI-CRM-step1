import { createLogger, type ApplicationLogger } from "@ai-crm/observability";
import { createFileWorkerHealthReporter } from "./health-file.js";
import { createWorkerApplication, type WorkerApplication, type WorkerComposition } from "./index.js";
import { createDefaultProductionWorkerResources, type ProductionWorkerResources } from "./production-composition.js";
import { loadWorkerRuntimeConfiguration, type WorkerRuntimeConfiguration } from "./runtime-config.js";

export interface WorkerBootstrapOptions {
  readonly configuration?: Readonly<WorkerRuntimeConfiguration>;
  readonly composition?: Omit<WorkerComposition, "drainTimeoutMs" | "healthRefreshIntervalMs" | "healthReporter" | "logger" | "startupTimeoutMs">;
  readonly logger?: ApplicationLogger;
  readonly productionResourceFactory?: (signal: AbortSignal, cleanupTimeoutMs: number) => Promise<ProductionWorkerResources>;
}

export async function bootstrapWorker(options: WorkerBootstrapOptions = {}): Promise<0 | 1> {
  let logger = options.logger;
  let app: WorkerApplication | undefined;
  let productionResources: ProductionWorkerResources | undefined;
  try {
    const config = options.configuration ?? await loadWorkerRuntimeConfiguration();
    logger ??= createLogger({
      environment: config.environment,
      instanceId: config.instanceId,
      level: config.logLevel,
      service: "ai-crm.worker",
      version: config.release,
    });
    const healthReporter = createFileWorkerHealthReporter(config.healthFile);
    healthReporter.report("unavailable");
    const composition = options.composition ?? {};
    if (config.environment === "production") {
      const controller = new AbortController();
      const abort = (): void => { controller.abort(); };
      process.once("SIGTERM", abort);
      process.once("SIGINT", abort);
      try {
        productionResources = await (options.productionResourceFactory ?? createDefaultProductionWorkerResources)(
          controller.signal,
          config.drainTimeoutMs,
        );
        await productionResources.assertDatabaseCompatible(controller.signal);
      } finally {
        process.off("SIGTERM", abort);
        process.off("SIGINT", abort);
      }
    }
    app = createWorkerApplication({
      ...composition,
      ...(productionResources === undefined ? {} : {
        dependencies: productionResources.readiness,
        handlers: productionResources.handlers,
        onStop: productionResources.close,
        requireHandlers: true,
      }),
      drainTimeoutMs: config.drainTimeoutMs,
      healthRefreshIntervalMs: config.healthRefreshMs,
      healthReporter,
      logger,
      requireHandlers: productionResources !== undefined,
      startupTimeoutMs: config.startupTimeoutMs,
    });
    await app.start();
    return await app.waitForExit();
  } catch (error) {
    if (app && error instanceof Error && error.message === "worker_start_cancelled") return app.waitForExit();
    if (productionResources !== undefined) {
      try { await productionResources.close(); }
      catch {
        try { logger?.log("error", { errorCode: "worker_production_cleanup_failed", operation: "worker.bootstrap.cleanup", outcome: "failed" }); }
        catch { /* Cleanup failure still results in a stable non-zero bootstrap outcome. */ }
      }
    }
    try { logger?.log("error", { errorCode: "worker_bootstrap_failed", operation: "worker.bootstrap", outcome: "failed" }); } catch { /* Bootstrap must still return a stable non-zero result. */ }
    return 1;
  }
}
