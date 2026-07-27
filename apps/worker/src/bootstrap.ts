import { createLogger, type ApplicationLogger } from "@ai-crm/observability";
import { createFileWorkerHealthReporter } from "./health-file.js";
import { createWorkerApplication, type WorkerApplication, type WorkerComposition } from "./index.js";
import { loadWorkerRuntimeConfiguration, type WorkerRuntimeConfiguration } from "./runtime-config.js";

export interface WorkerBootstrapOptions {
  readonly configuration?: Readonly<WorkerRuntimeConfiguration>;
  readonly composition?: Omit<WorkerComposition, "drainTimeoutMs" | "healthRefreshIntervalMs" | "healthReporter" | "logger" | "startupTimeoutMs">;
  readonly logger?: ApplicationLogger;
}

export async function bootstrapWorker(options: WorkerBootstrapOptions = {}): Promise<0 | 1> {
  let logger = options.logger;
  let app: WorkerApplication | undefined;
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
    if (config.environment === "production") throw new Error("worker_production_composition_unavailable");
    app = createWorkerApplication({
      ...composition,
      drainTimeoutMs: config.drainTimeoutMs,
      healthRefreshIntervalMs: config.healthRefreshMs,
      healthReporter,
      logger,
      requireHandlers: false,
      startupTimeoutMs: config.startupTimeoutMs,
    });
    await app.start();
    return await app.waitForExit();
  } catch (error) {
    if (app && error instanceof Error && error.message === "worker_start_cancelled") return app.waitForExit();
    try { logger?.log("error", { errorCode: "worker_bootstrap_failed", operation: "worker.bootstrap", outcome: "failed" }); } catch { /* Bootstrap must still return a stable non-zero result. */ }
    return 1;
  }
}
