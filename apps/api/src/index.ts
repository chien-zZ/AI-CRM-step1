import "reflect-metadata";
import { Controller, Get, Inject, Injectable, Module, Res, type OnApplicationShutdown } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { DynamicModule, INestApplication } from "@nestjs/common";
import type { Response } from "express";
import { evaluateHealth, type ApplicationLogger, type HealthDependency, type HealthResult } from "@ai-crm/observability";

export const applicationId = "@ai-crm/api" as const;
const API_COMPOSITION = Symbol("api-composition");
const API_RUNTIME_STATE = Symbol("api-runtime-state");
interface ApiRuntimeState { ready: boolean; }

export interface ApiComposition {
  readonly dependencies?: () => readonly HealthDependency[];
  readonly logger: ApplicationLogger;
  readonly onStart?: (signal: AbortSignal) => void | Promise<void>;
  readonly onStop?: () => void | Promise<void>;
  readonly startupTimeoutMs?: number;
}

const unavailableDependency = Object.freeze([{ name: "dependency-check", required: true, healthy: false }]);
function apiDependencies(composition: ApiComposition): readonly HealthDependency[] {
  try {
    return composition.dependencies?.() ?? [];
  } catch {
    composition.logger.log("error", { errorCode: "api_dependency_check_failed", operation: "api.health.dependencies", outcome: "failed" });
    return unavailableDependency;
  }
}

@Controller("health")
class HealthController {
  constructor(
    @Inject(API_COMPOSITION) private readonly composition: ApiComposition,
    @Inject(API_RUNTIME_STATE) private readonly state: ApiRuntimeState,
  ) {}

  @Get("live")
  liveness(): HealthResult { return evaluateHealth("liveness"); }

  @Get("ready")
  readiness(@Res() response: Response): void {
    const result = this.state.ready
      ? evaluateHealth("readiness", apiDependencies(this.composition))
      : { status: "unavailable" as const };
    response.status(result.status === "ok" ? 200 : 503).json(result);
  }
}

@Injectable()
class ApiLifecycle implements OnApplicationShutdown {
  constructor(@Inject(API_COMPOSITION) private readonly composition: ApiComposition) {}
  async onApplicationShutdown(): Promise<void> {
    try {
      await this.composition.onStop?.();
      this.composition.logger.log("info", { operation: "api.lifecycle.stop", outcome: "succeeded" });
    } catch (error) {
      this.composition.logger.log("error", { errorCode: "api_stop_failed", operation: "api.lifecycle.stop", outcome: "failed" });
      throw error;
    }
  }
}

@Module({})
// Nest requires a class as the module token; behavior is supplied by the dynamic module below.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class ApiModule {}

const createApiModule = (composition: ApiComposition, state: ApiRuntimeState): DynamicModule => ({
  controllers: [HealthController],
  module: ApiModule,
  providers: [
    { provide: API_COMPOSITION, useValue: composition },
    { provide: API_RUNTIME_STATE, useValue: state },
    ApiLifecycle,
  ],
});

export interface ApiApplication {
  readonly health: (kind: "liveness" | "readiness") => HealthResult;
  readonly instance: () => INestApplication | undefined;
  readonly start: (port?: number, host?: string) => Promise<void>;
  readonly stop: () => Promise<void>;
}

async function apiSettleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<{ readonly kind: "completed"; readonly value: T } | { readonly kind: "timeout" }> {
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

export const createApiApplication = (composition: ApiComposition): ApiApplication => {
  let application: INestApplication | undefined;
  let activeStart = 0;
  let startPromise: Promise<void> | undefined;
  let startController: AbortController | undefined;
  let stopping: Promise<void> | undefined;
  const state: ApiRuntimeState = { ready: false };
  const startupTimeoutMs = composition.startupTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 1 || startupTimeoutMs > 300_000) throw new Error("api_startup_timeout_invalid");
  const health = (kind: "liveness" | "readiness"): HealthResult =>
    kind === "readiness" && !state.ready
      ? { status: "unavailable" }
      : evaluateHealth(kind, apiDependencies(composition));
  const start = async (port = 3000, host = "0.0.0.0"): Promise<void> => {
    if (stopping) await stopping;
    if (application) return;
    if (startPromise) return startPromise;
    startPromise = (async () => {
      const startId = ++activeStart;
      let candidate: INestApplication | undefined;
      let candidateClose: Promise<void> | undefined;
      let stopHook: Promise<void> | undefined;
      const controller = new AbortController();
      startController = controller;
      const cancelled = (): boolean => controller.signal.aborted || startId !== activeStart;
      const closeCandidate = async (): Promise<void> => {
        const candidateToClose = candidate;
        if (candidateToClose && !candidateClose) candidateClose = Promise.resolve().then(async () => { await candidateToClose.close(); });
        await candidateClose;
      };
      const stopAttempt = async (): Promise<void> => {
        stopHook ??= Promise.resolve().then(async () => { await composition.onStop?.(); });
        await stopHook;
      };
      const attemptComposition: ApiComposition = { ...composition, onStop: stopAttempt };
      try {
        composition.logger.log("info", { operation: "api.lifecycle.start", outcome: "started" });
        const initialize = (async (): Promise<void> => {
          await composition.onStart?.(controller.signal);
          if (cancelled()) throw new Error("api_start_cancelled");
          candidate = await NestFactory.create(createApiModule(attemptComposition, state), { abortOnError: false, logger: false });
          if (cancelled()) {
            await closeCandidate();
            throw new Error("api_start_cancelled");
          }
          candidate.enableShutdownHooks(["SIGTERM", "SIGINT"]);
          await candidate.listen(port, host);
          if (cancelled()) {
            await closeCandidate();
            throw new Error("api_start_cancelled");
          }
        })();
        const startupResult = await apiSettleWithin(initialize, startupTimeoutMs);
        if (startupResult.kind === "timeout") throw new Error("api_start_timeout");
        if (cancelled() || !candidate) throw new Error("api_start_cancelled");
        application = candidate;
        if (startId === activeStart) state.ready = true;
        composition.logger.log("info", { operation: "api.lifecycle.start", outcome: "succeeded" });
      } catch (error) {
        controller.abort();
        if (startId === activeStart) activeStart += 1;
        state.ready = false;
        composition.logger.log("error", { errorCode: "api_start_failed", operation: "api.lifecycle.start", outcome: "failed" });
        const cleanup = Promise.allSettled([closeCandidate(), stopAttempt()]);
        const cleanupResult = await apiSettleWithin(cleanup, startupTimeoutMs);
        if (cleanupResult.kind === "timeout") {
          composition.logger.log("error", { errorCode: "api_start_cleanup_failed", operation: "api.lifecycle.stop", outcome: "failed" });
        }
        application = undefined;
        throw error;
      }
    })().finally(() => { startController = undefined; startPromise = undefined; });
    return startPromise;
  };
  const stop = async (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      if (startPromise) {
        activeStart += 1;
        startController?.abort();
        const startupResult = await apiSettleWithin(startPromise, startupTimeoutMs);
        if (startupResult.kind === "timeout") throw new Error("api_start_stop_timeout");
      }
      if (!application) return;
      state.ready = false;
      await application.close();
      application = undefined;
    })().finally(() => { stopping = undefined; });
    return stopping;
  };
  return { health, instance: () => application, start, stop };
};

export * from "./auth/index.js";
export { loadApiRuntimeConfiguration, type ApiRuntimeConfiguration } from "./runtime-config.js";
