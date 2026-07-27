import { configuration, loadConfiguration, type LoadConfigurationOptions } from "@ai-crm/config";

const schema = {
  environment: configuration.enumeration("NODE_ENV", ["development", "test", "production"], { default: "development" }),
  host: configuration.string("AI_CRM_API_HOST", { default: "0.0.0.0", pattern: /^(?:0\.0\.0\.0|127\.0\.0\.1|::1)$/u }),
  instanceId: configuration.string("AI_CRM_INSTANCE_ID", { default: "api-local", maxLength: 128, pattern: /^[a-z][a-z0-9_.-]*$/u }),
  port: configuration.integer("AI_CRM_API_PORT", { default: 3000, maximum: 65_535, minimum: 0 }),
  release: configuration.string("AI_CRM_RELEASE", { default: "development", maxLength: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u }),
  shutdownTimeoutMs: configuration.integer("AI_CRM_API_SHUTDOWN_TIMEOUT_MS", { default: 30_000, maximum: 300_000, minimum: 1 }),
  startupTimeoutMs: configuration.integer("AI_CRM_API_STARTUP_TIMEOUT_MS", { default: 30_000, maximum: 300_000, minimum: 1 }),
} as const;

export interface ApiRuntimeConfiguration {
  readonly environment: "development" | "test" | "production";
  readonly host: string;
  readonly instanceId: string;
  readonly port: number;
  readonly release: string;
  readonly shutdownTimeoutMs: number;
  readonly startupTimeoutMs: number;
}

export async function loadApiRuntimeConfiguration(options: LoadConfigurationOptions = {}): Promise<Readonly<ApiRuntimeConfiguration>> {
  const value = await loadConfiguration(schema, options);
  if (value.port === 0 && value.environment !== "test") throw new Error("api_ephemeral_port_test_only");
  if (value.environment === "production" && value.release === "development") throw new Error("api_release_required");
  if (value.environment === "production" && value.instanceId === "api-local") throw new Error("api_instance_id_required");
  if (value.environment === "production" && (value.host !== "0.0.0.0" || value.port !== 3000)) {
    throw new Error("api_production_bind_invalid");
  }
  return value;
}
