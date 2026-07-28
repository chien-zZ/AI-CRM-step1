import { describe, expect, it, vi } from "vitest";
import { bootstrapWorker } from "./bootstrap.js";
import { defaultWorkerHealthFile, type WorkerRuntimeConfiguration } from "./runtime-config.js";
import { taskProjectionConsumerPolicyUnavailable, type ProductionWorkerResources } from "./production-composition.js";

const productionConfiguration: Readonly<WorkerRuntimeConfiguration> = Object.freeze({
  drainTimeoutMs: 100,
  environment: "production",
  healthFile: defaultWorkerHealthFile,
  healthMaxAgeMs: 45_000,
  healthRefreshMs: 10_000,
  instanceId: "worker-test",
  logLevel: "info",
  release: "2026.07.28.1",
  startupTimeoutMs: 100,
});

describe("production Worker bootstrap gate", () => {
  it("validates generic resources, then exits non-zero and closes them for the unavailable Task policy", async () => {
    const close = vi.fn(() => Promise.resolve());
    const assertDatabaseCompatible = vi.fn(() => Promise.resolve());
    const assertTaskProjectionConsumerPolicyAvailable = vi.fn(() => { throw new Error(taskProjectionConsumerPolicyUnavailable); });
    const resources: ProductionWorkerResources = {
      assertDatabaseCompatible,
      assertTaskProjectionConsumerPolicyAvailable,
      close,
      readiness: () => [{ healthy: false, name: taskProjectionConsumerPolicyUnavailable, required: true }],
    };
    const productionResourceFactory = vi.fn(() => Promise.resolve(resources));
    await expect(bootstrapWorker({
      configuration: productionConfiguration,
      logger: { log: vi.fn() },
      productionResourceFactory,
    })).resolves.toBe(1);
    expect(productionResourceFactory).toHaveBeenCalledOnce();
    expect(assertDatabaseCompatible).toHaveBeenCalledOnce();
    expect(assertTaskProjectionConsumerPolicyAvailable).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps the non-zero outcome when failure cleanup itself cannot be proven", async () => {
    const log = vi.fn();
    const resources: ProductionWorkerResources = {
      assertDatabaseCompatible: () => Promise.resolve(),
      assertTaskProjectionConsumerPolicyAvailable: () => { throw new Error(taskProjectionConsumerPolicyUnavailable); },
      close: () => Promise.reject(new Error("synthetic close failure")),
      readiness: () => [],
    };
    await expect(bootstrapWorker({
      configuration: productionConfiguration,
      logger: { log },
      productionResourceFactory: () => Promise.resolve(resources),
    })).resolves.toBe(1);
    expect(log).toHaveBeenCalledWith("error", expect.objectContaining({ errorCode: "worker_production_cleanup_failed" }));
  });
});
