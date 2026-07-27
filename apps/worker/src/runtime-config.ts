import { isAbsolute } from "node:path";
import { configuration, loadConfiguration, type LoadConfigurationOptions } from "@ai-crm/config";

export const defaultWorkerHealthFile = "/tmp/ai-crm-worker-ready.json";

const schema = {
  drainTimeoutSeconds: configuration.integer("AI_CRM_WORKER_DRAIN_TIMEOUT_SECONDS", { default: 30, maximum: 300, minimum: 1 }),
  environment: configuration.enumeration("NODE_ENV", ["development", "test", "production"], { default: "development" }),
  healthFile: configuration.string("AI_CRM_WORKER_HEALTH_FILE", { default: defaultWorkerHealthFile, maxLength: 512 }),
  healthMaxAgeSeconds: configuration.integer("AI_CRM_WORKER_HEALTH_MAX_AGE_SECONDS", { default: 45, maximum: 300, minimum: 5 }),
  healthRefreshSeconds: configuration.integer("AI_CRM_WORKER_HEALTH_REFRESH_SECONDS", { default: 10, maximum: 60, minimum: 1 }),
  instanceId: configuration.string("AI_CRM_INSTANCE_ID", { default: `worker-${String(process.pid)}`, maxLength: 128, pattern: /^[a-z][a-z0-9_.-]*$/u }),
  logLevel: configuration.enumeration("AI_CRM_LOG_LEVEL", ["debug", "info", "warn", "error"], { default: "info" }),
  release: configuration.string("AI_CRM_RELEASE", { default: "development", maxLength: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u }),
  startupTimeoutSeconds: configuration.integer("AI_CRM_WORKER_STARTUP_TIMEOUT_SECONDS", { default: 30, maximum: 300, minimum: 1 }),
} as const;

export interface WorkerRuntimeConfiguration {
  readonly drainTimeoutMs: number;
  readonly environment: "development" | "test" | "production";
  readonly healthFile: string;
  readonly healthMaxAgeMs: number;
  readonly healthRefreshMs: number;
  readonly instanceId: string;
  readonly logLevel: "debug" | "info" | "warn" | "error";
  readonly release: string;
  readonly startupTimeoutMs: number;
}

export async function loadWorkerRuntimeConfiguration(options: LoadConfigurationOptions = {}): Promise<Readonly<WorkerRuntimeConfiguration>> {
  const value = await loadConfiguration(schema, options);
  if (value.environment === "production" && value.release === "development") throw new Error("worker_release_required");
  if (!isAbsolute(value.healthFile) || (value.environment === "production" && value.healthFile !== defaultWorkerHealthFile)) {
    throw new Error("worker_health_file_invalid");
  }
  if (value.healthRefreshSeconds * 2 >= value.healthMaxAgeSeconds) throw new Error("worker_health_window_invalid");
  return Object.freeze({
    drainTimeoutMs: value.drainTimeoutSeconds * 1_000,
    environment: value.environment,
    healthFile: value.healthFile,
    healthMaxAgeMs: value.healthMaxAgeSeconds * 1_000,
    healthRefreshMs: value.healthRefreshSeconds * 1_000,
    instanceId: value.instanceId,
    logLevel: value.logLevel,
    release: value.release,
    startupTimeoutMs: value.startupTimeoutSeconds * 1_000,
  });
}
