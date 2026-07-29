import { describe, expect, it } from "vitest";

import { evaluateHealth } from "./health.js";

describe("evaluateHealth", () => {
  const dependencies = [
    { healthy: false, name: "database", required: true },
    { healthy: false, name: "optional-cache", required: false },
  ] as const;

  it("keeps liveness independent of downstream state", () => {
    expect(evaluateHealth("liveness", dependencies)).toEqual({ status: "ok" });
  });

  it("fails readiness only for required dependencies", () => {
    expect(evaluateHealth("readiness", dependencies)).toEqual({ status: "unavailable" });
    expect(evaluateHealth("readiness", [dependencies[1]])).toEqual({ status: "ok" });
  });

  it("returns bounded diagnostic names without internal details", () => {
    expect(evaluateHealth("diagnostic", [
      ...dependencies,
      { healthy: true, name: "database", required: true },
      { healthy: false, name: "postgres://user:password@host", required: true },
    ])).toEqual({
      checks: { database: "unavailable", "optional-cache": "unavailable" },
      status: "unavailable",
    });
  });

  it("fails closed when a required dependency has an unsafe diagnostic name", () => {
    expect(evaluateHealth("readiness", [
      { healthy: true, name: "postgres://user:password@host", required: true },
    ])).toEqual({ status: "unavailable" });
  });
});
