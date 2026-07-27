import { pathToFileURL } from "node:url";

import { createLogger, type ApplicationLogger } from "@ai-crm/observability";
import type { LoadConfigurationOptions } from "@ai-crm/config";

import { defaultApiPlatformBindingFactory, type ApiPlatformBindingFactory } from "./composition-factory.js";
import { createApiPlatformComposition, type ApiPlatformBindings } from "./composition.js";
import { createApiApplication, type ApiApplication } from "./index.js";
import { loadApiRuntimeConfiguration, type ApiRuntimeConfiguration } from "./runtime-config.js";

export interface ApiProcessPort {
  exitCode: number | undefined;
  off(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export interface BootstrapApiProcessOptions {
  readonly bindings: ApiPlatformBindings;
  readonly configuration: Readonly<ApiRuntimeConfiguration>;
  readonly logger: ApplicationLogger;
  readonly processPort?: ApiProcessPort;
}

export interface RunningApiProcess {
  readonly application: ApiApplication;
  readonly shutdown: () => Promise<void>;
}

export async function bootstrapApiProcess(options: BootstrapApiProcessOptions): Promise<Readonly<RunningApiProcess>> {
  const platform = createApiPlatformComposition(options.bindings);
  const application = createApiApplication({
    ...platform.lifecycle,
    logger: options.logger,
    shutdownTimeoutMs: options.configuration.shutdownTimeoutMs,
    startupTimeoutMs: options.configuration.startupTimeoutMs,
  });
  const processPort = (options.processPort ?? process) as ApiProcessPort;
  let shutdownPromise: Promise<void> | undefined;
  const removeListeners = (): void => {
    processPort.off("SIGTERM", stopFromSignal);
    processPort.off("SIGINT", stopFromSignal);
  };
  const shutdown = async (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      try {
        await application.stop();
        options.logger.log("info", { operation: "api.process.shutdown", outcome: "succeeded" });
      } finally {
        removeListeners();
      }
    })();
    return shutdownPromise;
  };
  function stopFromSignal(): void {
    void shutdown().then(
      () => { processPort.exitCode = 0; },
      () => {
        processPort.exitCode = 1;
        options.logger.log("error", { errorCode: "api_process_shutdown_failed", operation: "api.process.shutdown", outcome: "failed" });
      },
    );
  }

  processPort.once("SIGTERM", stopFromSignal);
  processPort.once("SIGINT", stopFromSignal);
  try {
    await application.start(options.configuration.port, options.configuration.host);
    return Object.freeze({ application, shutdown });
  } catch (error) {
    removeListeners();
    options.logger.log("error", { errorCode: "api_bootstrap_failed", operation: "api.process.bootstrap", outcome: "failed" });
    throw error;
  }
}

export interface RunApiMainOptions {
  readonly bindingFactory?: ApiPlatformBindingFactory;
  readonly configuration?: LoadConfigurationOptions;
  readonly processPort?: ApiProcessPort;
}

export async function runApiMain(options: RunApiMainOptions = {}): Promise<Readonly<RunningApiProcess>> {
  const configuration = await loadApiRuntimeConfiguration(options.configuration);
  const logger = createLogger({
    environment: configuration.environment,
    instanceId: configuration.instanceId,
    service: "api",
    version: configuration.release,
  });
  const processPort = (options.processPort ?? process) as ApiProcessPort;
  const controller = new AbortController();
  let interrupted = false;
  const stopAcquisition = (): void => {
    interrupted = true;
    controller.abort();
  };
  const wasInterrupted = (): boolean => interrupted;
  processPort.once("SIGTERM", stopAcquisition);
  processPort.once("SIGINT", stopAcquisition);
  const timer = setTimeout(() => { controller.abort(); }, configuration.startupTimeoutMs);
  let bindings: ApiPlatformBindings;
  try {
    bindings = await (options.bindingFactory ?? defaultApiPlatformBindingFactory).create(configuration, controller.signal);
    if (controller.signal.aborted) {
      await bindings.close?.();
      throw new Error(wasInterrupted() ? "api_start_cancelled" : "api_start_timeout");
    }
  } catch (error) {
    const cancelled = wasInterrupted() && error instanceof Error && error.message === "api_start_cancelled";
    const timedOut = !wasInterrupted() && controller.signal.aborted &&
      error instanceof Error && error.message === "api_start_cancelled";
    if (wasInterrupted()) processPort.exitCode = cancelled ? 0 : 1;
    logger.log("error", {
      errorCode: cancelled ? "api_start_cancelled" : timedOut ? "api_start_timeout" : "api_binding_factory_failed",
      operation: "api.process.bindings",
      outcome: "failed",
    });
    if (timedOut) throw new Error("api_start_timeout", { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
    processPort.off("SIGTERM", stopAcquisition);
    processPort.off("SIGINT", stopAcquisition);
  }
  return bootstrapApiProcess({
    bindings,
    configuration,
    logger,
    processPort,
  });
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  void runApiMain().catch(() => { process.exitCode ??= 1; });
}
