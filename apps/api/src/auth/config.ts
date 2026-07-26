import {
  configuration,
  loadConfiguration,
  type LoadConfigurationOptions,
} from "@ai-crm/config";
import { timingSafeEqual } from "node:crypto";

import { BrowserSessionFailure } from "./errors.js";
import type { KeyEncryptionKey } from "./session-security.js";

export interface PcBffConfiguration {
  readonly allowedOrigin: string;
  readonly keycloakClientId: string;
  readonly keycloakAudience: string;
  readonly keycloakClientSecret: string;
  readonly keycloakIssuer: string;
  readonly loginTransactionTtlSeconds: number;
  readonly oidcTimeoutSeconds: number;
  readonly redirectUri: string;
  readonly refreshLeaseTtlMs: number;
  readonly redisConnectTimeoutMs: number;
  readonly redisPassword: string;
  readonly redisUrl: string;
  readonly sessionAbsoluteTtlSeconds: number;
  readonly sessionDecryptionKeys: readonly Readonly<KeyEncryptionKey>[];
  readonly sessionEncryptionKey: Readonly<KeyEncryptionKey>;
  readonly sessionIdleTtlSeconds: number;
  readonly sessionIndexingKey: Uint8Array;
}

const pcBffSchema = {
  allowedOrigin: configuration.url("AI_CRM_PC_ALLOWED_ORIGIN", { protocols: ["https:", "http:"] }),
  keycloakClientId: configuration.string("AI_CRM_PC_OIDC_CLIENT_ID", { maxLength: 255 }),
  keycloakAudience: configuration.string("AI_CRM_OIDC_API_AUDIENCE", { maxLength: 255 }),
  keycloakClientSecret: configuration.secretFile("AI_CRM_PC_OIDC_CLIENT_SECRET_FILE"),
  keycloakIssuer: configuration.url("AI_CRM_KEYCLOAK_ISSUER", { protocols: ["https:", "http:"] }),
  loginTransactionTtlSeconds: configuration.integer("AI_CRM_PC_LOGIN_TRANSACTION_TTL_SECONDS", {
    maximum: 900,
    minimum: 30,
  }),
  oidcTimeoutSeconds: configuration.integer("AI_CRM_PC_OIDC_TIMEOUT_SECONDS", {
    maximum: 60,
    minimum: 1,
  }),
  redirectUri: configuration.url("AI_CRM_PC_OIDC_REDIRECT_URI", { protocols: ["https:", "http:"] }),
  refreshLeaseTtlMs: configuration.integer("AI_CRM_PC_REFRESH_LEASE_TTL_MS", {
    maximum: 120_000,
    minimum: 1_000,
  }),
  redisConnectTimeoutMs: configuration.integer("AI_CRM_REDIS_CONNECT_TIMEOUT_MS", {
    maximum: 60_000,
    minimum: 100,
  }),
  redisPassword: configuration.secretFile("AI_CRM_REDIS_PASSWORD_FILE"),
  redisUrl: configuration.url("AI_CRM_REDIS_URL", { protocols: ["redis:", "rediss:"] }),
  sessionAbsoluteTtlSeconds: configuration.integer("AI_CRM_PC_SESSION_ABSOLUTE_TTL_SECONDS", {
    maximum: 31_536_000,
    minimum: 60,
  }),
  sessionEncryptionKey: configuration.secretFile("AI_CRM_PC_SESSION_ENCRYPTION_KEY_FILE"),
  sessionEncryptionKeyId: configuration.string("AI_CRM_PC_SESSION_ENCRYPTION_KEY_ID", {
    maxLength: 64,
    pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/u,
  }),
  sessionPreviousEncryptionKey: configuration.optionalSecretFile("AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_FILE"),
  sessionPreviousEncryptionKeyId: configuration.optionalString("AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_ID", {
    maxLength: 64,
    pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/u,
  }),
  sessionIdleTtlSeconds: configuration.integer("AI_CRM_PC_SESSION_IDLE_TTL_SECONDS", {
    maximum: 31_536_000,
    minimum: 60,
  }),
  sessionIndexingKey: configuration.secretFile("AI_CRM_PC_SESSION_INDEX_KEY_FILE"),
} as const;

function secureWebUrl(value: string, name: string): void {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  if (url.username || url.password) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  if (name === "allowed origin" && value !== url.origin && value !== `${url.origin}/`) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
}

function decodeKey(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  const key = Buffer.from(value, "base64url");
  if (key.byteLength !== 32 || key.toString("base64url") !== value) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  return new Uint8Array(key);
}

export async function loadPcBffConfiguration(
  options: LoadConfigurationOptions = {},
): Promise<Readonly<PcBffConfiguration>> {
  const raw = await loadConfiguration(pcBffSchema, options);
  secureWebUrl(raw.allowedOrigin, "allowed origin");
  secureWebUrl(raw.keycloakIssuer, "issuer");
  secureWebUrl(raw.redirectUri, "redirect URI");
  if (!/^[A-Za-z0-9_-]{43}$/u.test(raw.keycloakClientSecret)) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  if (raw.sessionAbsoluteTtlSeconds < raw.sessionIdleTtlSeconds) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  const encryptionKey = decodeKey(raw.sessionEncryptionKey);
  const indexingKey = decodeKey(raw.sessionIndexingKey);
  if (timingSafeEqual(encryptionKey, indexingKey)) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  const previousPairComplete = raw.sessionPreviousEncryptionKey !== undefined &&
    raw.sessionPreviousEncryptionKeyId !== undefined;
  if (previousPairComplete !== (raw.sessionPreviousEncryptionKey !== undefined ||
    raw.sessionPreviousEncryptionKeyId !== undefined)) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  const currentKey = Object.freeze({ id: raw.sessionEncryptionKeyId, value: encryptionKey });
  const previousKey = previousPairComplete
    ? Object.freeze({
      id: raw.sessionPreviousEncryptionKeyId,
      value: decodeKey(raw.sessionPreviousEncryptionKey),
    })
    : undefined;
  if (previousKey !== undefined && (previousKey.id === currentKey.id ||
    timingSafeEqual(previousKey.value, currentKey.value) || timingSafeEqual(previousKey.value, indexingKey))) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  return Object.freeze({
    allowedOrigin: new URL(raw.allowedOrigin).origin,
    keycloakClientId: raw.keycloakClientId,
    keycloakAudience: raw.keycloakAudience,
    keycloakClientSecret: raw.keycloakClientSecret,
    keycloakIssuer: raw.keycloakIssuer.replace(/\/$/u, ""),
    loginTransactionTtlSeconds: raw.loginTransactionTtlSeconds,
    oidcTimeoutSeconds: raw.oidcTimeoutSeconds,
    redirectUri: raw.redirectUri,
    refreshLeaseTtlMs: raw.refreshLeaseTtlMs,
    redisConnectTimeoutMs: raw.redisConnectTimeoutMs,
    redisPassword: raw.redisPassword,
    redisUrl: raw.redisUrl,
    sessionAbsoluteTtlSeconds: raw.sessionAbsoluteTtlSeconds,
    sessionDecryptionKeys: Object.freeze(previousKey === undefined ? [currentKey] : [currentKey, previousKey]),
    sessionEncryptionKey: currentKey,
    sessionIdleTtlSeconds: raw.sessionIdleTtlSeconds,
    sessionIndexingKey: indexingKey,
  });
}
