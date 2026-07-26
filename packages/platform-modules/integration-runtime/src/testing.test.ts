import { describe, expect, it } from "vitest";
import { createInMemoryReplayStore, createScriptedOperation } from "./testing.js";

describe("integration fault fixtures", () => {
  it("plays deterministic transient errors and results", async () => {
    const fixture = createScriptedOperation([
      { kind: "error", category: "rate_limited", retryable: true },
      { kind: "result", value: "synthetic-result" },
    ]);
    await expect(fixture.invoke(new AbortController().signal)).rejects.toMatchObject({
      category: "rate_limited",
      retryable: true,
    });
    await expect(fixture.invoke(new AbortController().signal)).resolves.toBe("synthetic-result");
    expect(fixture.calls()).toBe(2);
  });

  it("models duplicate replay reservations without claiming durability", async () => {
    const store = createInMemoryReplayStore();
    await expect(store.reserve({ expiresAt: "2026-07-26T08:01:00.000Z", fingerprints: ["event", "nonce"] }))
      .resolves.toEqual({ accepted: true, reservationId: "fixture-1" });
    await expect(store.reserve({ expiresAt: "2026-07-26T08:01:00.000Z", fingerprints: ["another-event", "nonce"] }))
      .resolves.toEqual({ accepted: false });
  });

  it("allows a timeout fixture to settle only after observing cancellation", async () => {
    const fixture = createScriptedOperation<string>([{ kind: "wait_for_abort" }]);
    const controller = new AbortController();
    const pending = fixture.invoke(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ category: "cancelled" });
  });
});
