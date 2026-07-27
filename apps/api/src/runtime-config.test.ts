import { describe, expect, it } from "vitest";
import { loadApiRuntimeConfiguration } from "./runtime-config.js";

describe("API runtime configuration", () => {
  it("uses the reviewed container defaults", async () => {
    await expect(loadApiRuntimeConfiguration({ env: {} })).resolves.toEqual({
      environment: "development", host: "0.0.0.0", instanceId: "api-local", port: 3000, release: "development",
      shutdownTimeoutMs: 30_000, startupTimeoutMs: 30_000,
    });
  });

  it("rejects an invalid bind address and port", async () => {
    await expect(loadApiRuntimeConfiguration({ env: { AI_CRM_API_HOST: "public.example", AI_CRM_API_PORT: "65536" } })).rejects.toThrow();
    await expect(loadApiRuntimeConfiguration({ env: { AI_CRM_API_PORT: "0" } })).rejects.toThrow("api_ephemeral_port_test_only");
  });

  it("fails closed when production release or container binding is missing", async () => {
    await expect(loadApiRuntimeConfiguration({ env: { NODE_ENV: "production" } })).rejects.toThrow("api_release_required");
    await expect(loadApiRuntimeConfiguration({ env: { AI_CRM_API_HOST: "127.0.0.1", AI_CRM_INSTANCE_ID: "api-1", AI_CRM_RELEASE: "2026.07.27.1", NODE_ENV: "production" } })).rejects.toThrow("api_production_bind_invalid");
    await expect(loadApiRuntimeConfiguration({ env: { AI_CRM_RELEASE: "2026.07.27.1", NODE_ENV: "production" } })).rejects.toThrow("api_instance_id_required");
  });
});
