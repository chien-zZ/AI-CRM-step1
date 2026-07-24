import { describe, expect, it } from "vitest";

import { runWithCorrelationContext } from "./context.js";
import { createLogger } from "./logger.js";

describe("createLogger", () => {
  it("emits one JSON line with fixed identity and sanitized fields", () => {
    const lines: string[] = [];
    const logger = createLogger({
      environment: "test",
      instanceId: "api-1",
      service: "api",
      version: "1.2.3",
      write: (line) => lines.push(line),
    });
    runWithCorrelationContext({ requestId: "request-1" }, () => {
      logger.log("error", {
        errorCode: "dependency.unavailable",
        fields: { password: "secret", state: "down" },
        operation: "dependency.check",
        outcome: "degraded",
      });
    });

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(record).toMatchObject({
      environment: "test",
      error_code: "dependency.unavailable",
      fields: { password: "[REDACTED]", state: "down" },
      instance_id: "api-1",
      level: 50,
      operation: "dependency.check",
      outcome: "degraded",
      request_id: "request-1",
      service: "api",
      version: "1.2.3",
    });
    expect(lines[0]?.split("\n").filter(Boolean)).toHaveLength(1);
    expect(lines[0]).not.toContain("secret");
  });

  it("rejects uncontrolled operation names", () => {
    const logger = createLogger({
      environment: "test",
      instanceId: "api-1",
      service: "api",
      version: "1",
      write: () => undefined,
    });
    expect(() => {
      logger.log("info", {
        operation: "user supplied free text",
        outcome: "failed",
      });
    }).toThrow("OBSERVABILITY_INVALID_OPERATION");
  });

  it("drops untrusted trace identifiers without logging their contents", () => {
    const lines: string[] = [];
    const logger = createLogger({
      environment: "test",
      instanceId: "api-1",
      service: "api",
      version: "1",
      write: (line) => lines.push(line),
    });
    logger.log("warn", {
      operation: "trace.invalid",
      outcome: "rejected",
      spanId: "do-not-repeat-span",
      traceId: "do-not-repeat-trace",
    });

    const record = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(record).not.toHaveProperty("span_id");
    expect(record).not.toHaveProperty("trace_id");
    expect(lines[0]).not.toContain("do-not-repeat");
  });
});
