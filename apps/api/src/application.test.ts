import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { request as httpRequest } from "node:http";
import type { OutgoingHttpHeaders } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createApiApplication } from "./index.js";

const logger = { log: () => undefined };

function requestStatus(url: URL, options: { readonly headers?: OutgoingHttpHeaders | readonly string[]; readonly method?: string }): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers: options.headers, method: options.method }, (response) => {
      response.resume();
      response.on("end", () => { resolve(response.statusCode ?? 0); });
    });
    request.on("error", reject);
    request.end();
  });
}

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

  it("exposes the reviewed PC BFF HTTP adapter without returning credentials in bodies", async () => {
    const authentication = {
      beginLogin: vi.fn().mockResolvedValue({ headers: { Location: "https://identity.invalid/login" }, status: 302 }),
      completeLogin: vi.fn(),
      currentSession: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn(),
    };
    const app = createApiApplication({
      authentication,
      authenticationCallbackUrl: (path) => `https://api.invalid${path}`,
      logger,
    });
    await app.start(0);
    const url = await app.instance()?.getUrl();
    if (url === undefined) throw new Error("api_not_started");
    const response = await fetch(`${url}/auth/pc/login?returnTo=%2Fworkspace`, { redirect: "manual" });
    expect({ body: await response.text(), location: response.headers.get("location"), status: response.status }).toEqual({
      body: "",
      location: "https://identity.invalid/login",
      status: 302,
    });
    expect(authentication.beginLogin).toHaveBeenCalledWith("/workspace");
    await app.stop();
  });

  it("rejects repeated or out-of-contract authentication inputs before the adapter", async () => {
    const authentication = {
      beginLogin: vi.fn(), completeLogin: vi.fn(), currentSession: vi.fn(), logout: vi.fn(), refresh: vi.fn(),
    };
    const app = createApiApplication({
      authentication,
      authenticationCallbackUrl: (path) => `https://api.invalid${path}`,
      logger,
    });
    await app.start(0, "127.0.0.1");
    const address = await app.instance()?.getUrl();
    if (address === undefined) throw new Error("api_not_started");
    expect((await fetch(`${address}/auth/pc/login?returnTo=%2Fa&returnTo=%2Fb`)).status).toBe(400);
    expect((await fetch(`${address}/auth/pc/callback?code=ok&state=short`)).status).toBe(400);
    expect((await fetch(`${address}/auth/pc/refresh`, { method: "POST" })).status).toBe(403);
    expect(await requestStatus(new URL("/auth/pc/logout", address), {
      headers: { origin: `https://${"a".repeat(513)}.invalid` },
      method: "POST",
    })).toBe(403);
    expect(await requestStatus(new URL("/auth/pc/session", address), {
      headers: { cookie: `session=${"a".repeat(4097)}` },
    })).toBe(401);
    expect(authentication.beginLogin).not.toHaveBeenCalled();
    expect(authentication.completeLogin).not.toHaveBeenCalled();
    expect(authentication.refresh).not.toHaveBeenCalled();
    expect(authentication.logout).not.toHaveBeenCalled();
    expect(authentication.currentSession).not.toHaveBeenCalled();
    await app.stop();
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
    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
    expect(app.health("readiness")).toEqual({ status: "unavailable" });
  });

  it("enters terminal state when failed-start cleanup rejects", async () => {
    const app = createApiApplication({
      logger,
      onStart: () => { throw new Error("synthetic_start_failure"); },
      onStop: () => { throw new Error("synthetic_cleanup_failure"); },
      startupTimeoutMs: 20,
    });
    await expect(app.start(0)).rejects.toThrow("synthetic_start_failure");
    await expect(app.start(0)).rejects.toThrow("api_terminal");
  });

  it("enters terminal state when failed-start cleanup times out", async () => {
    const app = createApiApplication({
      logger,
      onStart: () => { throw new Error("synthetic_start_failure"); },
      onStop: () => new Promise(() => undefined),
      startupTimeoutMs: 5,
    });
    await expect(app.start(0)).rejects.toThrow("synthetic_start_failure");
    await expect(app.start(0)).rejects.toThrow("api_terminal");
  });

  it("treats an uncooperative timed-out startup as terminal", async () => {
    const app = createApiApplication({
      logger,
      onStart: () => new Promise(() => undefined),
      startupTimeoutMs: 5,
    });
    await expect(app.start(0)).rejects.toThrow("api_start_timeout");
    await expect(app.start(0)).rejects.toThrow("api_terminal");
  });

  it("bounds stop and makes a timed-out application terminal", async () => {
    const close = vi.fn(() => new Promise<void>(() => undefined));
    const candidate = {
      close,
      enableShutdownHooks: vi.fn(),
      listen: vi.fn(() => Promise.resolve()),
    } as unknown as INestApplication;
    const create = vi.spyOn(NestFactory, "create").mockResolvedValueOnce(candidate);
    try {
      const app = createApiApplication({ logger, shutdownTimeoutMs: 5 });
      await app.start(0);
      await expect(app.stop()).rejects.toThrow("api_stop_timeout");
      await expect(app.start(0)).rejects.toThrow("api_terminal");
    } finally {
      create.mockRestore();
    }
  });

  it("makes an application terminal when its stop hook rejects", async () => {
    const app = createApiApplication({ logger, onStop: () => { throw new Error("synthetic_stop_failure"); } });
    await app.start(0);
    await expect(app.stop()).rejects.toThrow("api_stop_failed");
    await expect(app.start(0)).rejects.toThrow("api_terminal");
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
      expect(outcomes[0]).toBeInstanceOf(Error);
      expect(outcomes[1]).toBeUndefined();
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
