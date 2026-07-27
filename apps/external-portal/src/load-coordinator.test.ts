import { describe, expect, it, vi } from "vitest";
import { createLoadCoordinator } from "./load-coordinator";

describe("load coordinator", () => {
  it("coalesces duplicate in-flight bootstrap calls", async () => {
    let resolve!: (value: { kind: "empty" }) => void;
    const pending = new Promise<{ kind: "empty" }>((done) => { resolve = done; });
    const load = vi.fn(() => pending);
    const coordinator = createLoadCoordinator(load);
    const first = coordinator.load();
    const duplicate = coordinator.load();
    expect(first).toBe(duplicate);
    expect(load).toHaveBeenCalledTimes(1);
    resolve({ kind: "empty" });
    await expect(first).resolves.toEqual({ kind: "empty" });
  });

  it("maps dependency failure and invalidated stale completion to unavailable", async () => {
    const failed = createLoadCoordinator(() => Promise.reject(new Error("synthetic dependency failure")));
    await expect(failed.load()).resolves.toEqual({ kind: "unavailable" });

    let resolve!: (value: { kind: "empty" }) => void;
    const stale = createLoadCoordinator(() => new Promise((done) => { resolve = done; }));
    const result = stale.load();
    stale.invalidate();
    resolve({ kind: "empty" });
    await expect(result).resolves.toEqual({ kind: "unavailable" });
  });
});
