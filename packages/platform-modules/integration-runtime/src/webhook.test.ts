import { describe, expect, it, vi } from "vitest";
import { IntegrationRuntimeError } from "./errors.js";
import { acceptVerifiedWebhook, type WebhookEnvelope } from "./webhook.js";

const receivedAt = "2026-07-26T08:00:00.000Z";
const envelope: WebhookEnvelope = {
  eventId: "event-1",
  nonce: "nonce-1",
  rawBody: new TextEncoder().encode('{"synthetic":true}'),
  receivedAt,
  signature: "opaque-test-signature",
  timestamp: receivedAt,
  version: "v1",
};

describe("Webhook acceptance", () => {
  it("verifies the raw body before reserving a durable replay key", async () => {
    const order: string[] = [];
    const result = await acceptVerifiedWebhook(envelope, {
      allowedClockSkewMs: 1000,
      maxBodyBytes: 1024,
      now: () => new Date(receivedAt),
      replayRetentionMs: 60_000,
      replayStore: {
        reserve: () => {
          order.push("reserve");
          return Promise.resolve({ accepted: true, reservationId: "receipt-1" });
        },
      },
      verifier: {
        verify: ({ eventId, rawBody }) => {
          order.push("verify");
          expect(eventId).toBe("event-1");
          expect(new TextDecoder().decode(rawBody)).toBe('{"synthetic":true}');
          return Promise.resolve(true);
        },
      },
    });
    expect(order).toEqual(["verify", "reserve"]);
    expect(result).toMatchObject({ eventId: "event-1", protocolVersion: "v1", reservationId: "receipt-1", version: 1 });
    expect(result.bodyDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails closed on invalid signatures without touching replay storage", async () => {
    const reserve = vi.fn(() => Promise.resolve({ accepted: true, reservationId: "unused" }));
    await expect(acceptVerifiedWebhook(envelope, {
      allowedClockSkewMs: 1000,
      maxBodyBytes: 1024,
      now: () => new Date(receivedAt),
      replayRetentionMs: 60_000,
      replayStore: { reserve },
      verifier: { verify: () => Promise.resolve(false) },
    })).rejects.toMatchObject({ category: "signature_invalid" });
    expect(reserve).not.toHaveBeenCalled();
  });

  it("rejects stale timestamps and duplicate durable reservations", async () => {
    const verifier = vi.fn(() => Promise.resolve(true));
    await expect(acceptVerifiedWebhook(envelope, {
      allowedClockSkewMs: 1000,
      maxBodyBytes: 1024,
      now: () => new Date("2026-07-26T08:01:00.000Z"),
      replayRetentionMs: 60_000,
      replayStore: { reserve: () => Promise.resolve({ accepted: true, reservationId: "unused" }) },
      verifier: { verify: verifier },
    })).rejects.toMatchObject({ category: "signature_invalid" });
    expect(verifier).not.toHaveBeenCalled();

    await expect(acceptVerifiedWebhook(envelope, {
      allowedClockSkewMs: 1000,
      maxBodyBytes: 1024,
      now: () => new Date(receivedAt),
      replayRetentionMs: 60_000,
      replayStore: { reserve: () => Promise.resolve({ accepted: false }) },
      verifier: { verify: () => Promise.resolve(true) },
    })).rejects.toMatchObject({ category: "replay_detected" });
  });

  it("reserves independent event and nonce fingerprints atomically", async () => {
    let captured: readonly string[] = [];
    await acceptVerifiedWebhook(envelope, {
      allowedClockSkewMs: 1000,
      maxBodyBytes: 1024,
      now: () => new Date(receivedAt),
      replayRetentionMs: 60_000,
      replayStore: {
        reserve: ({ fingerprints }) => {
          captured = fingerprints;
          return Promise.resolve({ accepted: true, reservationId: "receipt-2" });
        },
      },
      verifier: { verify: () => Promise.resolve(true) },
    });
    expect(captured).toHaveLength(2);
    expect(captured[0]).not.toBe(captured[1]);
    expect(captured.every((value) => /^[a-f0-9]{64}$/.test(value))).toBe(true);
  });

  it("snapshots verified bytes and rejects verifier mutation before replay reservation", async () => {
    const callerBody = new TextEncoder().encode("original");
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const reserve = vi.fn(() => Promise.resolve({ accepted: true, reservationId: "unused" }));
    const pending = acceptVerifiedWebhook({ ...envelope, rawBody: callerBody }, {
      allowedClockSkewMs: 1000,
      maxBodyBytes: 1024,
      now: () => new Date(receivedAt),
      replayRetentionMs: 60_000,
      replayStore: { reserve },
      verifier: { verify: async ({ rawBody }) => {
        await waiting;
        expect(new TextDecoder().decode(rawBody)).toBe("original");
        rawBody[0] = 0;
        return true;
      } },
    });
    callerBody.fill(1);
    release();
    await expect(pending).rejects.toMatchObject({ category: "signature_invalid" });
    expect(reserve).not.toHaveBeenCalled();
  });

  it("rejects invalid bytes and normalizes replay store failures and malformed results", async () => {
    const reserve = vi.fn(() => Promise.resolve({ accepted: true, reservationId: "unused" }));
    await expect(acceptVerifiedWebhook({ ...envelope, rawBody: "not-bytes" as unknown as Uint8Array }, {
      allowedClockSkewMs: 1000, maxBodyBytes: 1024, now: () => new Date(receivedAt), replayRetentionMs: 60_000,
      replayStore: { reserve }, verifier: { verify: () => Promise.resolve(true) },
    })).rejects.toMatchObject({ category: "invalid_input" });
    expect(reserve).not.toHaveBeenCalled();

    const base = { allowedClockSkewMs: 1000, maxBodyBytes: 1024, now: () => new Date(receivedAt), replayRetentionMs: 60_000, verifier: { verify: () => Promise.resolve(true) } };
    await expect(acceptVerifiedWebhook(envelope, { ...base, replayStore: { reserve: () => Promise.reject(new IntegrationRuntimeError("replay_detected")) } }))
      .rejects.toMatchObject({ category: "upstream_unavailable", retryable: true });
    await expect(acceptVerifiedWebhook(envelope, { ...base, replayStore: { reserve: () => Promise.resolve({ accepted: "yes" } as never) } }))
      .rejects.toMatchObject({ category: "upstream_unavailable", retryable: true });
  });

  it("requires replay retention to cover the full accepted signature window", async () => {
    const reserve = vi.fn(() => Promise.resolve({ accepted: true, reservationId: "unused" }));
    await expect(acceptVerifiedWebhook(envelope, {
      allowedClockSkewMs: 1_000, maxBodyBytes: 1024, now: () => new Date(receivedAt), replayRetentionMs: 1_999,
      replayStore: { reserve }, verifier: { verify: () => Promise.resolve(true) },
    })).rejects.toMatchObject({ category: "invalid_input" });
    expect(reserve).not.toHaveBeenCalled();
  });
});
