import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { BrowserSessionFailure } from "./errors.js";

const CREDENTIAL_BYTES = 32;
const ENCRYPTION_KEY_BYTES = 32;
const INITIALIZATION_VECTOR_BYTES = 12;
const MAX_TOKEN_LENGTH = 16_384;
// Keep the complete encrypted token payload comfortably below the Redis
// session-record limit after base64 and JSON envelope overhead are added.
const MAX_TOKEN_PAYLOAD_BYTES = 32 * 1024;
const MAX_ENCODED_TOKEN_PAYLOAD_LENGTH = Math.ceil(MAX_TOKEN_PAYLOAD_BYTES / 3) * 4;
const MAX_SESSION_SECONDS = 31_536_000;
const SAFE_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export interface KeyEncryptionKey {
  readonly id: string;
  readonly value: Uint8Array;
}

export interface SessionTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly idToken?: string;
}

export interface EncryptedSessionTokenSet {
  readonly algorithm: "A256GCM";
  readonly ciphertext: string;
  readonly initializationVector: string;
  readonly keyId: string;
  readonly tag: string;
  readonly version: 1 | 2;
}

export interface BrowserMutationEvidence {
  readonly allowedOrigins: readonly string[];
  readonly csrfHeader: string | undefined;
  readonly csrfSessionValue: string;
  readonly origin: string | undefined;
  readonly referer: string | undefined;
}

function validateCredential(value: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
}

function validateEncryptionKey(key: KeyEncryptionKey): void {
  if (!SAFE_KEY_ID.test(key.id) || key.value.byteLength !== ENCRYPTION_KEY_BYTES) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
}

function validateToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TOKEN_LENGTH;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object";
}

function decodeBoundedBase64Url(value: unknown, maximumLength: number): Buffer {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength ||
    !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  return Buffer.from(value, "base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHmac("sha256", "ai-crm-constant-time-compare").update(left).digest();
  const rightDigest = createHmac("sha256", "ai-crm-constant-time-compare").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function normalizeOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function requestOrigin(evidence: BrowserMutationEvidence): string | undefined {
  if (evidence.origin !== undefined) return normalizeOrigin(evidence.origin);
  if (evidence.referer === undefined) return undefined;
  return normalizeOrigin(evidence.referer);
}

export function createOpaqueCredential(): string {
  return randomBytes(CREDENTIAL_BYTES).toString("base64url");
}

export function createSessionIndex(credential: string, indexingKey: Uint8Array): string {
  validateCredential(credential);
  if (indexingKey.byteLength < ENCRYPTION_KEY_BYTES) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  return createHmac("sha256", indexingKey).update(credential).digest("base64url");
}

export function encryptSessionTokens(
  tokens: SessionTokenSet,
  key: KeyEncryptionKey,
  sessionReference: string,
): Readonly<EncryptedSessionTokenSet> {
  validateEncryptionKey(key);
  validateCredential(sessionReference);
  if (!validateToken(tokens.accessToken) || !validateToken(tokens.refreshToken) ||
    (tokens.idToken !== undefined && !validateToken(tokens.idToken))) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  const plaintext = Buffer.from(JSON.stringify(tokens), "utf8");
  if (plaintext.byteLength > MAX_TOKEN_PAYLOAD_BYTES) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  const initializationVector = randomBytes(INITIALIZATION_VECTOR_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key.value, initializationVector);
  cipher.setAAD(Buffer.from(`ai-crm:bff-session:v2:${key.id}:${sessionReference}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return Object.freeze({
    algorithm: "A256GCM",
    ciphertext: ciphertext.toString("base64url"),
    initializationVector: initializationVector.toString("base64url"),
    keyId: key.id,
    tag: cipher.getAuthTag().toString("base64url"),
    version: 2,
  });
}

export function decryptSessionTokens(
  encrypted: unknown,
  keys: readonly KeyEncryptionKey[],
  sessionReference: string,
): Readonly<SessionTokenSet> {
  validateCredential(sessionReference);
  if (!isRecord(encrypted)) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  const envelope = encrypted;
  if ((envelope["version"] !== 1 && envelope["version"] !== 2) || envelope["algorithm"] !== "A256GCM" ||
    typeof envelope["keyId"] !== "string") {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  const key = keys.find((candidate) => candidate.id === envelope["keyId"]);
  if (!key) throw new BrowserSessionFailure("authentication_session_invalid");
  validateEncryptionKey(key);
  try {
    const initializationVector = decodeBoundedBase64Url(envelope["initializationVector"], 32);
    const tag = decodeBoundedBase64Url(envelope["tag"], 32);
    const ciphertext = decodeBoundedBase64Url(envelope["ciphertext"], MAX_ENCODED_TOKEN_PAYLOAD_LENGTH);
    if (initializationVector.byteLength !== INITIALIZATION_VECTOR_BYTES || tag.byteLength !== 16) {
      throw new BrowserSessionFailure("authentication_session_invalid");
    }
    if (ciphertext.byteLength > MAX_TOKEN_PAYLOAD_BYTES) throw new BrowserSessionFailure("authentication_session_invalid");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key.value,
      initializationVector,
    );
    const additionalData = envelope["version"] === 1
      ? `ai-crm:bff-session:v1:${key.id}`
      : `ai-crm:bff-session:v2:${key.id}:${sessionReference}`;
    decipher.setAAD(Buffer.from(additionalData, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    const parsed: unknown = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid session payload.");
    const accessToken = "accessToken" in parsed ? parsed.accessToken : undefined;
    const refreshToken = "refreshToken" in parsed ? parsed.refreshToken : undefined;
    const idToken = "idToken" in parsed ? parsed.idToken : undefined;
    if (!validateToken(accessToken) || !validateToken(refreshToken) ||
      (idToken !== undefined && !validateToken(idToken))) {
      throw new Error("Invalid session payload.");
    }
    return Object.freeze(idToken === undefined
      ? { accessToken, refreshToken }
      : { accessToken, idToken, refreshToken });
  } catch {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
}

export function validateBrowserMutation(evidence: BrowserMutationEvidence): void {
  const origin = requestOrigin(evidence);
  const allowed = origin !== undefined && evidence.allowedOrigins.some((candidate) => {
    const normalized = normalizeOrigin(candidate);
    return normalized !== undefined && constantTimeEqual(normalized, origin);
  });
  const csrfValid = evidence.csrfHeader !== undefined
    && constantTimeEqual(evidence.csrfHeader, evidence.csrfSessionValue);
  if (!allowed || !csrfValid) throw new BrowserSessionFailure("authentication_csrf_rejected");
}

export function serializePcSessionCookie(credential: string, maxAgeSeconds: number): string {
  validateCredential(credential);
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0 || maxAgeSeconds > MAX_SESSION_SECONDS) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  return `__Host-ai_crm_pc_session=${credential}; Path=/; Max-Age=${String(maxAgeSeconds)}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearPcSessionCookie(): string {
  return "__Host-ai_crm_pc_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
}
