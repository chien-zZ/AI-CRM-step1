import { describe, expect, it } from "vitest";

import { sanitizeTelemetry } from "./sanitize.js";

describe("sanitizeTelemetry", () => {
  it("redacts nested sensitive keys and values", () => {
    expect(sanitizeTelemetry({
      authorization: "Bearer abc.def",
      nested: [{ cookie: "value", state: "accepted" }],
      operation: "work.started",
      privateKey: "-----BEGIN PRIVATE KEY-----secret",
    })).toEqual({
      authorization: "[REDACTED]",
      nested: [{ cookie: "[REDACTED]", state: "accepted" }],
      operation: "work.started",
      privateKey: "[REDACTED]",
    });
  });

  it("serializes errors without messages or stacks and sanitizes causes", () => {
    const cause = new Error("secret database response");
    const error = new Error("raw customer text", { cause });
    expect(sanitizeTelemetry(error)).toEqual({
      cause: { type: "Error" },
      type: "Error",
    });
  });

  it("does not execute accessors and handles cycles and unknown objects", () => {
    let accessed = false;
    const value: Record<string, unknown> = { date: new Date(0) };
    Object.defineProperty(value, "computed", {
      enumerable: true,
      get() {
        accessed = true;
        return "unsafe";
      },
    });
    value["self"] = value;
    expect(sanitizeTelemetry(value)).toEqual({
      computed: "[ACCESSOR]",
      date: { type: "Date" },
      self: "[CIRCULAR]",
    });
    expect(accessed).toBe(false);
  });

  it("bounds depth, arrays, fields, and strings", () => {
    expect(sanitizeTelemetry(
      { a: "123456", b: [1, 2, 3], c: { d: { e: true } }, extra: true },
      { limits: { maxArrayLength: 2, maxDepth: 2, maxFields: 3, maxStringLength: 3 } },
    )).toEqual({
      a: "123[TRUNCATED]",
      b: [1, 2, "[TRUNCATED]"],
      c: { d: "[MAX_DEPTH]" },
      truncated: true,
    });
  });

  it("supports a top-level allowlist", () => {
    expect(sanitizeTelemetry(
      { ignored: "value", operation: "accepted" },
      { allowedKeys: ["operation"] },
    )).toEqual({ operation: "accepted" });
  });

  it("fails closed for hostile reflected objects", () => {
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error("unsafe proxy");
      },
    });
    expect(sanitizeTelemetry(hostile)).toEqual({ type: "Unknown" });
  });
});
