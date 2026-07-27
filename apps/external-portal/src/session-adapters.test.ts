import { describe, expect, it } from "vitest";
import { createH5SessionAdapter, createMemoryHandleStore, createWeappSessionAdapter } from "./session-adapters";

describe("external session adapters", () => {
  it("represents H5 session transport without exposing a Cookie value", () => {
    const session = createH5SessionAdapter();
    expect(session.credential()).toEqual({ kind: "h5-cookie" });
    session.clear();
    session.clear();
    expect(session.credential()).toEqual({ kind: "h5-cookie" });
  });

  it("holds only an injected opaque weapp handle and clears repeatedly", () => {
    const store = createMemoryHandleStore();
    const session = createWeappSessionAdapter(store);
    expect(session.credential()).toBeUndefined();
    store.write("opaque-synthetic-handle");
    expect(session.credential()).toEqual({ kind: "weapp-handle", handle: "opaque-synthetic-handle" });
    session.clear();
    session.clear();
    expect(session.credential()).toBeUndefined();
  });
});
