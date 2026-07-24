import { describe, expect, it, vi } from "vitest";

import {
  createErrorReporter,
  type ErrorEventClient,
  type SafeErrorEvent,
} from "./sentry.js";

function client(): ErrorEventClient & {
  capture: ReturnType<typeof vi.fn<(event: SafeErrorEvent) => void>>;
  flush: ReturnType<typeof vi.fn<(timeoutMilliseconds: number) => Promise<boolean>>>;
} {
  return {
    capture: vi.fn<(event: SafeErrorEvent) => void>(),
    flush: vi.fn<(timeoutMilliseconds: number) => Promise<boolean>>().mockResolvedValue(true),
  };
}

describe("createErrorReporter", () => {
  it("does nothing when disabled", async () => {
    const fake = client();
    const reporter = createErrorReporter({
      client: fake,
      enabled: false,
      environment: "test",
      release: "1",
    });
    reporter.capture({ errorCode: "error.code", operation: "work.failed" });
    expect(fake.capture).not.toHaveBeenCalled();
    await expect(reporter.flush()).resolves.toBe(true);
  });

  it("passes only stable and sanitized fields to the client boundary", () => {
    const fake = client();
    const reporter = createErrorReporter({
      client: fake,
      enabled: true,
      environment: "test",
      release: "1",
    });
    reporter.capture({
      errorCode: "dependency.failed",
      fields: { cookie: "secret", state: "unavailable" },
      operation: "dependency.call",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    });
    expect(fake.capture).toHaveBeenCalledWith({
      errorCode: "dependency.failed",
      fields: { cookie: "[REDACTED]", state: "unavailable" },
      operation: "dependency.call",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    });
  });

  it("replaces uncontrolled names and trace identifiers", () => {
    const fake = client();
    const reporter = createErrorReporter({
      client: fake,
      enabled: true,
      environment: "test",
      release: "1",
    });
    reporter.capture({
      errorCode: "https://example.test/private",
      operation: "customer supplied text",
      traceId: "do-not-repeat-trace",
    });

    expect(fake.capture).toHaveBeenCalledWith({
      errorCode: "invalid.telemetry.name",
      operation: "invalid.telemetry.name",
      traceId: "invalid.telemetry.trace_id",
    });
  });

  it("isolates synchronous, asynchronous, and flush failures", async () => {
    const fake: ErrorEventClient = {
      capture() {
        throw new Error("unavailable");
      },
      flush() {
        throw new Error("unavailable");
      },
    };
    const reporter = createErrorReporter({
      client: fake,
      enabled: true,
      environment: "test",
      release: "1",
    });
    expect(() => {
      reporter.capture({
        errorCode: "delivery.failed",
        operation: "telemetry.delivery",
      });
    }).not.toThrow();
    await expect(reporter.flush()).resolves.toBe(false);
  });
});
