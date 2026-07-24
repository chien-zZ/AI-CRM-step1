import { describe, expect, it } from "vitest";

import {
  createChildTraceContext,
  createTraceContext,
  extractTraceContext,
  injectTraceContext,
} from "./trace.js";

describe("trace propagation", () => {
  it("extracts a valid parent and creates a child span", () => {
    const context = extractTraceContext({
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    });
    expect(context.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(context.spanId).not.toBe("00f067aa0ba902b7");
    expect(context.traceFlags).toBe(1);
    expect(injectTraceContext(context)["traceparent"]).toMatch(
      /^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/u,
    );
  });

  it.each([
    "invalid",
    "00-00000000000000000000000000000000-0000000000000000-01",
  ])("rejects invalid input and generates a local context", (traceparent) => {
    const context = extractTraceContext({ traceparent });
    expect(context.traceId).toMatch(/^[0-9a-f]{32}$/u);
    expect(context.traceId).not.toBe("00000000000000000000000000000000");
  });

  it("creates local and child contexts", () => {
    const parent = createTraceContext();
    const child = createChildTraceContext(parent);
    expect(child.traceId).toBe(parent.traceId);
    expect(child.spanId).not.toBe(parent.spanId);
  });

  it("does not inject invalid project contexts", () => {
    expect(injectTraceContext({ traceFlags: 1, traceId: "bad", spanId: "bad" })).toEqual({});
  });
});
