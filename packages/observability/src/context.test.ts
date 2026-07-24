import { describe, expect, it } from "vitest";

import {
  getCorrelationContext,
  normalizeCorrelationContext,
  runWithCorrelationContext,
} from "./context.js";

describe("correlation context", () => {
  it("keeps bounded identifiers and positive attempts", () => {
    expect(normalizeCorrelationContext({
      attempt: 2,
      correlationId: "correlation-1",
      requestId: "invalid value",
      secret: "must-not-survive",
    } as never)).toEqual({ attempt: 2, correlationId: "correlation-1" });
  });

  it("scopes context without leaking it", () => {
    expect(getCorrelationContext()).toEqual({});
    runWithCorrelationContext({ requestId: "request-1" }, () => {
      expect(getCorrelationContext()).toEqual({ requestId: "request-1" });
    });
    expect(getCorrelationContext()).toEqual({});
  });
});
