import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultWorkerHealthFile, loadWorkerRuntimeConfiguration } from "./runtime-config.js";

describe("Worker runtime configuration", () => {
  it("converts the reviewed seconds configuration to milliseconds", async () => {
    await expect(loadWorkerRuntimeConfiguration({ env: {} })).resolves.toEqual({
      drainTimeoutMs: 30_000,
      environment: "development",
      healthFile: defaultWorkerHealthFile,
      healthMaxAgeMs: 45_000,
      healthRefreshMs: 10_000,
      instanceId: `worker-${String(process.pid)}`,
      logLevel: "info",
      release: "development",
      startupTimeoutMs: 30_000,
    });
  });

  it("allows an isolated health path in tests but fixes the production path", async () => {
    const testPath = resolve("worker-health-test.json");
    await expect(loadWorkerRuntimeConfiguration({ env: { AI_CRM_WORKER_HEALTH_FILE: testPath, NODE_ENV: "test" } })).resolves.toMatchObject({ healthFile: testPath });
    await expect(loadWorkerRuntimeConfiguration({ env: { AI_CRM_RELEASE: "2026.07.27.1", AI_CRM_WORKER_HEALTH_FILE: testPath, NODE_ENV: "production" } })).rejects.toThrow("worker_health_file_invalid");
  });

  it("rejects a refresh interval that cannot prove freshness", async () => {
    await expect(loadWorkerRuntimeConfiguration({ env: { AI_CRM_WORKER_HEALTH_MAX_AGE_SECONDS: "20", AI_CRM_WORKER_HEALTH_REFRESH_SECONDS: "10" } })).rejects.toThrow("worker_health_window_invalid");
  });

  it("requires an immutable production release", async () => {
    await expect(loadWorkerRuntimeConfiguration({ env: { NODE_ENV: "production" } })).rejects.toThrow("worker_release_required");
  });
});
