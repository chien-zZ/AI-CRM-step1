import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { createApiApplication } from "./index.js";

const logger = { log: () => undefined };

describe("API composition root", () => {
  it("exposes contract-shaped liveness and readiness", async () => {
    const app = createApiApplication({ dependencies: () => [{ name: "database", required: true, healthy: false }], logger });
    expect(app.health("liveness")).toEqual({ status: "ok" });
    expect(app.health("readiness")).toEqual({ status: "unavailable" });
    await app.start(0);
    const url = await app.instance()?.getUrl();
    if (url === undefined) throw new Error("api_not_started");
    const live = await fetch(`${url}/health/live`);
    const ready = await fetch(`${url}/health/ready`);
    const liveBody: unknown = await live.json();
    const readyBody: unknown = await ready.json();
    expect({ body: liveBody, status: live.status }).toEqual({ body: { status: "ok" }, status: 200 });
    expect({ body: readyBody, status: ready.status }).toEqual({ body: { status: "unavailable" }, status: 503 });
    await app.stop();
  });

  it("runs lifecycle hooks once and returns 404 for unregistered routes", async () => {
    const calls: string[] = [];
    const app = createApiApplication({ logger, onStart: () => { calls.push("start"); }, onStop: () => { calls.push("stop"); } });
    await app.start(0);
    expect(calls).toEqual(["start"]);
    await app.stop();
    await app.stop();
    expect(calls).toEqual(["start", "stop"]);
  });

  it("serializes concurrent starts", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const onStart = vi.fn(async () => { await gate; });
    const app = createApiApplication({ logger, onStart });
    const first = app.start(0);
    const second = app.start(0);
    release?.();
    await Promise.all([first, second]);
    expect(onStart).toHaveBeenCalledOnce();
    await app.stop();
  });

  it("fails readiness closed when dependency evaluation throws", async () => {
    const app = createApiApplication({ dependencies: () => { throw new Error("synthetic_dependency_failure"); }, logger });
    await app.start(0);
    const url = await app.instance()?.getUrl();
    if (url === undefined) throw new Error("api_not_started");
    const ready = await fetch(`${url}/health/ready`);
    expect({ body: await ready.json() as unknown, status: ready.status }).toEqual({ body: { status: "unavailable" }, status: 503 });
    await app.stop();
  });

  it("restarts only after an in-progress stop completes", async () => {
    let releaseStop: (() => void) | undefined;
    const stopGate = new Promise<void>((resolve) => { releaseStop = resolve; });
    const onStart = vi.fn();
    const app = createApiApplication({ logger, onStart, onStop: async () => { await stopGate; } });
    await app.start(0);
    const stopping = app.stop();
    const restarting = app.start(0);
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    expect(onStart).toHaveBeenCalledOnce();
    releaseStop?.();
    await Promise.all([stopping, restarting]);
    expect(onStart).toHaveBeenCalledTimes(2);
    await app.stop();
  });

  it("cancels an in-progress startup before stopping", async () => {
    const app = createApiApplication({
      logger,
      onStart: (signal) => new Promise<void>((resolve) => { signal.addEventListener("abort", () => { resolve(); }, { once: true }); }),
      startupTimeoutMs: 100,
    });
    const starting = app.start(0);
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    const stopping = app.stop();
    const results = await Promise.allSettled([starting, stopping]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(app.health("readiness")).toEqual({ status: "unavailable" });
  });

  it("closes a Nest application that is created after startup cancellation", async () => {
    let release: ((candidate: INestApplication) => void) | undefined;
    const delayedCandidate = new Promise<INestApplication>((resolve) => { release = resolve; });
    const close = vi.fn(() => Promise.resolve());
    const candidate = { close, enableShutdownHooks: vi.fn(), listen: vi.fn() } as unknown as INestApplication;
    const create = vi.spyOn(NestFactory, "create").mockReturnValueOnce(delayedCandidate);
    try {
      const app = createApiApplication({ logger, startupTimeoutMs: 100 });
      const starting = app.start(0);
      const startingOutcome = starting.then(() => undefined, (error: unknown) => error);
      await vi.waitFor(() => { expect(create).toHaveBeenCalledOnce(); });
      const stoppingOutcome = app.stop().then(() => undefined, (error: unknown) => error);
      const outcomes = await Promise.all([startingOutcome, stoppingOutcome]);
      expect(outcomes.every((outcome) => outcome instanceof Error)).toBe(true);
      release?.(candidate);
      await new Promise<void>((resolve) => { setImmediate(resolve); });
      expect(close).toHaveBeenCalledOnce();
      expect(app.instance()).toBeUndefined();
      expect(app.health("readiness")).toEqual({ status: "unavailable" });
    } finally {
      create.mockRestore();
    }
  });
});
