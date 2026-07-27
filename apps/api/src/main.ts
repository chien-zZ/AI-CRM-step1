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
  const processPort = options.processPort ?? process;
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
  const bindings = await (options.bindingFactory ?? defaultApiPlatformBindingFactory).create(configuration);
  return bootstrapApiProcess({
    bindings,
    configuration,
    logger,
    ...(options.processPort === undefined ? {} : { processPort: options.processPort }),
  });
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  void runApiMain().catch(() => { process.exitCode ??= 1; });
}
