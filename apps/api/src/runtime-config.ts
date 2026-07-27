import { configuration, loadConfiguration, type LoadConfigurationOptions } from "@ai-crm/config";

const schema = {
  environment: configuration.enumeration("NODE_ENV", ["development", "test", "production"], { default: "development" }),
  host: configuration.string("AI_CRM_API_HOST", { default: "0.0.0.0", pattern: /^(?:0\.0\.0\.0|127\.0\.0\.1|::1)$/u }),
  port: configuration.integer("AI_CRM_API_PORT", { default: 3000, maximum: 65_535, minimum: 1 }),
  release: configuration.string("AI_CRM_RELEASE", { default: "development", maxLength: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u }),
} as const;

export interface ApiRuntimeConfiguration {
  readonly environment: "development" | "test" | "production";
  readonly host: string;
  readonly port: number;
  readonly release: string;
}

export async function loadApiRuntimeConfiguration(options: LoadConfigurationOptions = {}): Promise<Readonly<ApiRuntimeConfiguration>> {
  const value = await loadConfiguration(schema, options);
  if (value.environment === "production" && value.release === "development") throw new Error("api_release_required");
  if (value.environment === "production" && (value.host !== "0.0.0.0" || value.port !== 3000)) {
    throw new Error("api_production_bind_invalid");
  }
  return value;
}
