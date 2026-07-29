import type { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { createWorkerApplication } from "./index.js";

const logger = { log: vi.fn() };
const runUntilAbort = (signal: AbortSignal): Promise<void> => new Promise((resolve) => {
  if (signal.aborted) resolve(); else signal.addEventListener("abort", () => { resolve(); }, { once: true });
});

describe("Worker composition root", () => {
  it("fails closed when a required dependency is unavailable", async () => {
    const report = vi.fn();
    const app = createWorkerApplication({ dependencies: () => [{ name: "rabbitmq", required: true, healthy: false }], healthReporter: { report }, logger });
    expect(app.health()).toEqual({ status: "unavailable" });
    await expect(app.start()).rejects.toThrow("worker_not_ready");
    expect(report).toHaveBeenLastCalledWith("unavailable");
  });

  it("drains handlers before running the stop hook", async () => {
    const stopHandler = vi.fn();
    const stopHook = vi.fn();
    const report = vi.fn();
    const app = createWorkerApplication({ handlers: [{ name: "outbox", ready: vi.fn(), run: runUntilAbort, stop: stopHandler }], healthReporter: { report }, logger, onStop: stopHook });
    await app.start();
    expect(app.health()).toEqual({ status: "ok" });
    expect(report).toHaveBeenLastCalledWith("ok");
    await app.stop();
    expect(stopHandler).toHaveBeenCalledOnce();
    expect(stopHook).toHaveBeenCalledOnce();
    expect(report).toHaveBeenLastCalledWith("unavailable");
    expect(app.isDraining()).toBe(false);
  });

  it("fails shutdown when in-flight work exceeds the configured deadline", async () => {
    const onStop = vi.fn();
    const app = createWorkerApplication({
      drainTimeoutMs: 5,
      handlers: [{ name: "stuck", ready: () => undefined, run: () => new Promise(() => undefined) }],
      logger,
      onStop,
    });
    await app.start();
    await expect(app.stop()).rejects.toThrow("worker_drain_timeout");
    expect(app.isDraining()).toBe(false);
    expect(onStop).toHaveBeenCalledOnce();
    await expect(app.start()).rejects.toThrow("worker_terminal");
  });

  it("bounds a stuck global cleanup phase", async () => {
    const app = createWorkerApplication({ drainTimeoutMs: 8, logger, onStop: () => new Promise(() => undefined) });
    await app.start();
    await expect(app.stop()).rejects.toThrow("worker_drain_timeout");
    await expect(app.start()).rejects.toThrow("worker_terminal");
  });

  it("keeps the two-phase drain within the configured total budget", async () => {
    const app = createWorkerApplication({
      drainTimeoutMs: 100,
      handlers: [{ name: "stuck", ready: () => undefined, run: () => new Promise(() => undefined) }],
      logger,
      onStop: () => new Promise(() => undefined),
    });
    await app.start();
    vi.useFakeTimers();
    try {
      const stopping = app.stop();
      const outcome = stopping.then(() => undefined, (error: unknown) => error);
      await vi.advanceTimersByTimeAsync(100);
      await expect(outcome).resolves.toEqual(expect.objectContaining({ message: "worker_drain_timeout" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the minimum drain timeout within its total budget", async () => {
    const app = createWorkerApplication({ drainTimeoutMs: 1, logger, onStop: () => new Promise(() => undefined) });
    await app.start();
    vi.useFakeTimers();
    try {
      const outcome = app.stop().then(() => undefined, (error: unknown) => error);
      await vi.advanceTimersByTimeAsync(1);
      await expect(outcome).resolves.toEqual(expect.objectContaining({ message: "worker_drain_timeout" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects startup when a handler fails before readiness", async () => {
    const report = vi.fn();
    const app = createWorkerApplication({ handlers: [{ name: "failed", ready: () => undefined, run: () => { throw new Error("synthetic_failure"); } }], healthReporter: { report }, logger });
    await expect(app.start()).rejects.toThrow("worker_handler_start_failed");
    expect(app.health()).toEqual({ status: "unavailable" });
    expect(report).toHaveBeenLastCalledWith("unavailable");
  });

  it("rejects startup when a handler exits after claiming readiness", async () => {
    const app = createWorkerApplication({ handlers: [{ name: "exited", ready: () => undefined, run: () => undefined }], logger });
    await expect(app.start()).rejects.toThrow("worker_handler_start_failed");
    expect(app.health()).toEqual({ status: "unavailable" });
  });

  it("fails startup when readiness publication cannot be proven", async () => {
    const statuses: string[] = [];
    const app = createWorkerApplication({
      healthReporter: { report: (status) => { statuses.push(status); if (status === "ok") throw new Error("synthetic_write_failure"); } },
      logger,
    });
    await expect(app.start()).rejects.toThrow("worker_health_report_failed");
    expect(statuses.slice(0, 2)).toEqual(["unavailable", "ok"]);
    expect(statuses.at(-1)).toBe("unavailable");
  });

  it("serializes concurrent starts", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const onStart = vi.fn(async () => { await gate; });
    const app = createWorkerApplication({ logger, onStart });
    const first = app.start();
    const second = app.start();
    release?.();
    await Promise.all([first, second]);
    expect(onStart).toHaveBeenCalledOnce();
    await app.stop();
  });

  it("restarts only after an in-progress stop completes", async () => {
    let releaseStop: (() => void) | undefined;
    const stopGate = new Promise<void>((resolve) => { releaseStop = resolve; });
    const onStart = vi.fn();
    const app = createWorkerApplication({ logger, onStart, onStop: async () => { await stopGate; } });
    await app.start();
    const stopping = app.stop();
    const restarting = app.start();
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    expect(onStart).toHaveBeenCalledOnce();
    releaseStop?.();
    await Promise.all([stopping, restarting]);
    expect(onStart).toHaveBeenCalledTimes(2);
    await app.stop();
  });

  it("fails dependency exceptions closed", async () => {
    const app = createWorkerApplication({ dependencies: () => { throw new Error("synthetic_dependency_failure"); }, logger });
    await expect(app.start()).rejects.toThrow("worker_not_ready");
    expect(app.health()).toEqual({ status: "unavailable" });
  });

  it("cancels a pending handler readiness before stopping", async () => {
    const app = createWorkerApplication({
      handlers: [{
        name: "pending",
        ready: (signal) => new Promise<void>((resolve) => { signal.addEventListener("abort", () => { resolve(); }, { once: true }); }),
        run: runUntilAbort,
      }],
      logger,
      startupTimeoutMs: 100,
    });
    const starting = app.start();
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    const stopping = app.stop();
    const results = await Promise.allSettled([starting, stopping]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
    expect(app.health()).toEqual({ status: "unavailable" });
  });

  it("does not report an abort-aware handler as failed during drain", async () => {
    logger.log.mockClear();
    const app = createWorkerApplication({
      handlers: [{
        name: "abort-aware",
        ready: () => undefined,
        run: (signal) => new Promise<void>((_resolve, reject) => { signal.addEventListener("abort", () => { reject(new Error("aborted")); }, { once: true }); }),
      }],
      logger,
    });
    await app.start();
    await app.stop();
    expect(logger.log).not.toHaveBeenCalledWith("error", expect.objectContaining({ errorCode: "worker_handler_failed" }));
  });

  it("never starts a handler whose readiness fails", async () => {
    const run = vi.fn(() => new Promise<void>(() => undefined));
    const app = createWorkerApplication({
      drainTimeoutMs: 5,
      handlers: [{
        name: "generation-bound",
        ready: () => { throw new Error("synthetic_readiness_failure"); },
        run,
      }],
      logger,
    });
    await expect(app.start()).rejects.toThrow("synthetic_readiness_failure");
    expect(run).not.toHaveBeenCalled();
  });

  it("can restart after a failed startup handler rejects on abort", async () => {
    let readyAttempt = 0;
    const app = createWorkerApplication({
      handlers: [{
        name: "abort-aware-startup",
        ready: () => { readyAttempt += 1; if (readyAttempt === 1) throw new Error("synthetic_readiness_failure"); },
        run: (signal) => new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => { reject(new Error("aborted")); }, { once: true });
        }),
      }],
      logger,
    });
    await expect(app.start()).rejects.toThrow("synthetic_readiness_failure");
    await app.start();
    expect(app.health()).toEqual({ status: "ok" });
    await app.stop();
  });

  it("closes a Nest context that is created after startup cancellation", async () => {
    let release: ((candidate: INestApplicationContext) => void) | undefined;
    const delayedCandidate = new Promise<INestApplicationContext>((resolve) => { release = resolve; });
    const close = vi.fn(() => Promise.resolve());
    const candidate = { close } as unknown as INestApplicationContext;
    const create = vi.spyOn(NestFactory, "createApplicationContext").mockReturnValueOnce(delayedCandidate);
    try {
      const app = createWorkerApplication({ logger, startupTimeoutMs: 100 });
      const starting = app.start();
      const startingOutcome = starting.then(() => undefined, (error: unknown) => error);
      await vi.waitFor(() => { expect(create).toHaveBeenCalledOnce(); });
      const stoppingOutcome = app.stop().then(() => undefined, (error: unknown) => error);
      const outcomes = await Promise.all([startingOutcome, stoppingOutcome]);
      expect(outcomes[0]).toBeInstanceOf(Error);
      expect(outcomes[1]).toBeUndefined();
      release?.(candidate);
      await new Promise<void>((resolve) => { setImmediate(resolve); });
      expect(close).toHaveBeenCalledOnce();
      expect(app.health()).toEqual({ status: "unavailable" });
    } finally {
      create.mockRestore();
    }
  });

  it.each(["resolved", "rejected"] as const)("performs one fatal drain when a ready handler %s", async (outcome) => {
    logger.log.mockClear();
    let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve, reject) => {
      finish = outcome === "resolved" ? resolve : () => { reject(new Error("synthetic_handler_failure")); };
    });
    const stop = vi.fn();
    const app = createWorkerApplication({
      handlers: [
        { name: "handler.one", ready: () => undefined, run: () => gate, stop },
        { name: "handler.two", ready: () => undefined, run: runUntilAbort, stop },
      ],
      logger,
    });
    await app.start();
    finish?.();
    await expect(app.waitForExit()).resolves.toBe(1);
    expect(stop).toHaveBeenCalledTimes(2);
    const fatalEvents = logger.log.mock.calls.filter((rawCall) => {
      const call = rawCall as [string, { readonly errorCode?: string }];
      return call[0] === "error" && ["worker_handler_failed", "worker_handler_stopped"].includes(call[1].errorCode ?? "");
    });
    expect(fatalEvents).toHaveLength(1);
    expect(app.health()).toEqual({ status: "unavailable" });
    await expect(app.start()).rejects.toThrow("worker_terminal");
  });

  it("rejects unsafe or duplicate handler telemetry identifiers before logging", () => {
    logger.log.mockClear();
    expect(() => createWorkerApplication({ handlers: [{ name: "unsafe value", ready: () => undefined, run: () => Promise.resolve() }], logger })).toThrow("worker_handler_id_invalid");
    expect(() => createWorkerApplication({ handlers: [
      { name: "same", ready: () => undefined, run: () => Promise.resolve() },
      { name: "same", ready: () => undefined, run: () => Promise.resolve() },
    ], logger })).toThrow("worker_handler_id_invalid");
    expect(logger.log).not.toHaveBeenCalled();
  });

  it("fails a required composition without a registered handler", () => {
    expect(() => createWorkerApplication({
      logger,
      requireHandlers: true,
    })).toThrow("worker_handlers_required");
  });

  it("does not let any handler acquire work until every handler is ready", async () => {
    let release: (() => void) | undefined;
    const readiness = new Promise<void>((resolve) => { release = resolve; });
    const firstRun = vi.fn(runUntilAbort);
    const secondRun = vi.fn(runUntilAbort);
    const app = createWorkerApplication({ handlers: [
      { name: "first", ready: () => undefined, run: firstRun },
      { name: "second", ready: () => readiness, run: secondRun },
    ], logger });
    const starting = app.start();
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    expect(firstRun).not.toHaveBeenCalled();
    expect(secondRun).not.toHaveBeenCalled();
    release?.();
    await starting;
    expect(firstRun).toHaveBeenCalledOnce();
    expect(secondRun).toHaveBeenCalledOnce();
    await app.stop();
  });

  it("rechecks required dependencies after all readiness checks and before acquisition", async () => {
    let healthy = true;
    const run = vi.fn(runUntilAbort);
    const app = createWorkerApplication({
      dependencies: () => [{ healthy, name: "rabbitmq", required: true }],
      handlers: [{ name: "dependent-ready", ready: () => { healthy = false; }, run }],
      logger,
    });
    await expect(app.start()).rejects.toThrow("worker_not_ready");
    expect(run).not.toHaveBeenCalled();
    expect(app.health()).toEqual({ status: "unavailable" });
  });

  it("fails startup when the final health evaluation is not ok", async () => {
    let checks = 0;
    const stop = vi.fn();
    const app = createWorkerApplication({
      dependencies: () => [{ healthy: ++checks < 3, name: "database", required: true }],
      handlers: [{ name: "final-health", ready: () => undefined, run: runUntilAbort, stop }],
      logger,
    });
    await expect(app.start()).rejects.toThrow("worker_not_ready");
    expect(stop).toHaveBeenCalledOnce();
    expect(app.health()).toEqual({ status: "unavailable" });
  });

  it("fatally drains when a required runtime dependency is lost", async () => {
    let healthy = true;
    const stop = vi.fn();
    const app = createWorkerApplication({
      dependencies: () => [{ healthy, name: "database", required: true }],
      handlers: [{ name: "dependent", ready: () => undefined, run: runUntilAbort, stop }],
      healthRefreshIntervalMs: 1_000,
      logger,
    });
    await app.start();
    vi.useFakeTimers();
    try {
      healthy = false;
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(app.waitForExit()).resolves.toBe(1);
      expect(stop).toHaveBeenCalledOnce();
      expect(app.health()).toEqual({ status: "unavailable" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fatally drains when periodic readiness publication fails", async () => {
    const stop = vi.fn(); let reports = 0;
    const app = createWorkerApplication({
      handlers: [{ name: "reported", ready: () => undefined, run: runUntilAbort, stop }],
      healthRefreshIntervalMs: 1_000,
      healthReporter: { report: () => { reports += 1; if (reports >= 3) throw new Error("synthetic_write_failure"); } },
      logger,
    });
    await app.start();
    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(app.waitForExit()).resolves.toBe(1);
      expect(stop).toHaveBeenCalledOnce();
      expect(app.health()).toEqual({ status: "unavailable" });
    } finally { vi.useRealTimers(); }
  });
});
