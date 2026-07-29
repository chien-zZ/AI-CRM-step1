import { describe, expect, it, vi } from "vitest";
import { bootstrapWorker } from "./bootstrap.js";
import { defaultWorkerHealthFile, type WorkerRuntimeConfiguration } from "./runtime-config.js";
import type { ProductionWorkerResources } from "./production-composition.js";

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
  it("validates resources, registers the production handler, and fails closed when it terminates", async () => {
    const close = vi.fn(() => Promise.resolve());
    const assertDatabaseCompatible = vi.fn(() => Promise.resolve());
    const resources: ProductionWorkerResources = {
      assertDatabaseCompatible,
      close,
      handlers: [{ name: "eventing.rabbit-inbox", ready: () => undefined, run: () => Promise.reject(new Error("synthetic consumer failure")) }],
      readiness: () => [{ healthy: true, name: "task-projection-consumer", required: true }],
    };
    const productionResourceFactory = vi.fn(() => Promise.resolve(resources));
    await expect(bootstrapWorker({
      configuration: productionConfiguration,
      logger: { log: vi.fn() },
      productionResourceFactory,
    })).resolves.toBe(1);
    expect(productionResourceFactory).toHaveBeenCalledOnce();
    expect(assertDatabaseCompatible).toHaveBeenCalledOnce();
    // Application shutdown owns the first close; the outer bootstrap catch
    // retries the idempotent production close boundary before returning 1.
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("keeps the non-zero outcome when failure cleanup itself cannot be proven", async () => {
    const log = vi.fn();
    const resources: ProductionWorkerResources = {
      assertDatabaseCompatible: () => Promise.resolve(),
      close: () => Promise.reject(new Error("synthetic close failure")),
      handlers: [{ name: "eventing.rabbit-inbox", ready: () => undefined, run: () => Promise.reject(new Error("synthetic consumer failure")) }],
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
