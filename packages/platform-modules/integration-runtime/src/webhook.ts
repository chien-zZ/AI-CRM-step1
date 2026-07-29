import { createHash } from "node:crypto";
import { IntegrationRuntimeError } from "./errors.js";

export interface WebhookEnvelope {
  readonly eventId: string;
  readonly nonce: string;
  readonly rawBody: Uint8Array;
  readonly receivedAt: string;
  readonly signature: string;
  readonly timestamp: string;
  readonly version: string;
}

export interface WebhookSignatureVerifier {
  verify(input: Readonly<{
    eventId: string;
    nonce: string;
    rawBody: Uint8Array;
    signature: string;
    timestamp: string;
    version: string;
  }>): Promise<boolean>;
}

export interface WebhookReplayReservation {
  readonly accepted: boolean;
  readonly reservationId?: string;
}

export interface WebhookReplayStore {
  reserve(input: Readonly<{ expiresAt: string; fingerprints: readonly string[] }>): Promise<WebhookReplayReservation>;
}

export interface AcceptedWebhook {
  readonly bodyDigest: string;
  readonly eventId: string;
  readonly protocolVersion: string;
  readonly receivedAt: string;
  readonly reservationId: string;
  readonly version: 1;
}

export interface WebhookAcceptanceOptions {
  readonly allowedClockSkewMs: number;
  readonly maxBodyBytes: number;
  readonly now?: () => Date;
  readonly replayRetentionMs: number;
  readonly replayStore: WebhookReplayStore;
  readonly verifier: WebhookSignatureVerifier;
}

function stableIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

export async function acceptVerifiedWebhook(
  envelope: WebhookEnvelope,
  options: WebhookAcceptanceOptions,
): Promise<AcceptedWebhook> {
  if (
    !Number.isSafeInteger(options.allowedClockSkewMs) || options.allowedClockSkewMs < 0
    || !Number.isSafeInteger(options.replayRetentionMs) || options.replayRetentionMs < 1
    || options.replayRetentionMs < options.allowedClockSkewMs * 2
    || !Number.isSafeInteger(options.maxBodyBytes) || options.maxBodyBytes < 1
    || !(envelope.rawBody instanceof Uint8Array)
    || envelope.rawBody.byteLength > options.maxBodyBytes
    || envelope.signature.length < 1
    || envelope.signature.length > 8192
    || envelope.timestamp.length > 64
    || envelope.receivedAt.length > 64
    || !stableIdentifier(envelope.eventId)
    || !stableIdentifier(envelope.nonce)
    || !/^v[1-9][0-9]*$/.test(envelope.version)
  ) {
    throw new IntegrationRuntimeError("invalid_input");
  }

  const rawBody = Uint8Array.from(envelope.rawBody);
  const bodyDigest = createHash("sha256").update(rawBody).digest("hex");

  const now = options.now?.() ?? new Date();
  const replayExpiresAt = now.getTime() + options.replayRetentionMs;
  const signedAt = new Date(envelope.timestamp);
  const receivedAt = new Date(envelope.receivedAt);
  if (
    Number.isNaN(now.getTime())
    || !Number.isSafeInteger(replayExpiresAt)
    || replayExpiresAt > 8_640_000_000_000_000
    || Number.isNaN(signedAt.getTime())
    || Number.isNaN(receivedAt.getTime())
    || Math.abs(now.getTime() - signedAt.getTime()) > options.allowedClockSkewMs
  ) {
    throw new IntegrationRuntimeError("signature_invalid");
  }

  let verified = false;
  try {
    verified = await options.verifier.verify({
      eventId: envelope.eventId,
      nonce: envelope.nonce,
      rawBody,
      signature: envelope.signature,
      timestamp: envelope.timestamp,
      version: envelope.version,
    });
  } catch (error) {
    throw new IntegrationRuntimeError("signature_invalid", { cause: error });
  }
  if (!verified || createHash("sha256").update(rawBody).digest("hex") !== bodyDigest) {
    throw new IntegrationRuntimeError("signature_invalid");
  }

  const fingerprint = (kind: "event" | "nonce", value: string): string => createHash("sha256")
    .update(kind)
    .update("\0")
    .update(envelope.version)
    .update("\0")
    .update(value)
    .digest("hex");
  let reservation: WebhookReplayReservation;
  try {
    const candidate: unknown = await options.replayStore.reserve({
      expiresAt: new Date(replayExpiresAt).toISOString(),
      fingerprints: [fingerprint("event", envelope.eventId), fingerprint("nonce", envelope.nonce)],
    });
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) throw new Error("Replay store returned a malformed reservation.");
    const keys = Object.keys(candidate);
    if (!keys.includes("accepted") || keys.some((key) => key !== "accepted" && key !== "reservationId")) throw new Error("Replay store returned a malformed reservation.");
    const accepted = (candidate as { readonly accepted?: unknown }).accepted;
    const reservationId = (candidate as { readonly reservationId?: unknown }).reservationId;
    if (typeof accepted !== "boolean" || (reservationId !== undefined && (typeof reservationId !== "string" || !stableIdentifier(reservationId)))) throw new Error("Replay store returned a malformed reservation.");
    if (accepted && reservationId === undefined) throw new Error("Replay store omitted its reservation ID.");
    if (!accepted && reservationId !== undefined) throw new Error("Rejected replay reservation unexpectedly returned an ID.");
    reservation = accepted ? { accepted, reservationId: reservationId as string } : { accepted };
  } catch (error) {
    throw new IntegrationRuntimeError("upstream_unavailable", { cause: error, retryable: true });
  }
  if (!reservation.accepted) throw new IntegrationRuntimeError("replay_detected");

  return {
    bodyDigest,
    eventId: envelope.eventId,
    protocolVersion: envelope.version,
    receivedAt: receivedAt.toISOString(),
    reservationId: reservation.reservationId as string,
    version: 1,
  };
}
