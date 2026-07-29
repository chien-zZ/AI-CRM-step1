import {
  AuthenticationFailure,
  type AuthenticatedPrincipal,
  type TokenVerifier,
} from "@ai-crm/platform-auth-context";
import { createTraceContext } from "@ai-crm/observability";
import { createHash, timingSafeEqual } from "node:crypto";

import { BrowserSessionFailure } from "./errors.js";
import type { OidcClientPort } from "./oidc.js";
import {
  createOpaqueCredential,
  createSessionIndex,
  decryptSessionTokens,
  encryptSessionTokens,
  type KeyEncryptionKey,
} from "./session-security.js";
import type { BrowserSessionStore, StoredBrowserSession } from "./session-store.js";

export type AuthenticationAuditAction =
  | "login_started"
  | "login_completed"
  | "session_refreshed"
  | "session_logout_requested";

export interface AuthenticationAuditEvent {
  readonly action: AuthenticationAuditAction;
  readonly operationId: string;
  readonly result: "succeeded";
  readonly sessionReference?: string;
  readonly traceId: string;
}

export interface AuthenticationAuditPort {
  record(event: AuthenticationAuditEvent): Promise<void>;
}

export interface PcBffSessionServiceOptions {
  readonly audit: AuthenticationAuditPort;
  readonly clock?: () => number;
  readonly decryptionKeys: readonly KeyEncryptionKey[];
  readonly encryptionKey: KeyEncryptionKey;
  readonly indexingKey: Uint8Array;
  readonly loginTransactionTtlSeconds: number;
  readonly oidc: OidcClientPort;
  readonly refreshLeaseTtlMs: number;
  readonly sessionAbsoluteTtlSeconds: number;
  readonly sessionIdleTtlSeconds: number;
  readonly store: BrowserSessionStore;
  readonly tokenVerifier: TokenVerifier;
}

export interface BrowserSessionView {
  readonly authenticatedAt: string;
  readonly client: "pc-web";
  readonly csrfToken: string;
  readonly expiresAt: string;
}

export interface LoginRedirect {
  readonly authorizationUrl: string;
}

export interface CompletedLogin {
  readonly credential: string;
  readonly returnTo: string;
  readonly session: Readonly<BrowserSessionView>;
}

export interface RefreshedSession {
  readonly credential: string;
  readonly session: Readonly<BrowserSessionView>;
}

export interface LogoutResult {
  readonly endSessionUrl?: string;
}

export interface BrowserMutationSession extends BrowserSessionView {
  readonly sessionReference: string;
}

export interface PcBffSessionService {
  beginLogin(returnTo: string): Promise<Readonly<LoginRedirect>>;
  completeLogin(callbackUrl: string): Promise<Readonly<CompletedLogin>>;
  currentSession(credential: string): Promise<Readonly<BrowserSessionView>>;
  logout(credential: string | undefined, sessionReference?: string): Promise<Readonly<LogoutResult>>;
  refresh(credential: string): Promise<Readonly<RefreshedSession>>;
  resolvePrincipal(credential: string): Promise<Readonly<AuthenticatedPrincipal>>;
  sessionForMutation(credential: string): Promise<Readonly<BrowserMutationSession>>;
}

const MAX_TTL_SECONDS = 31_536_000;
const MAX_DECRYPTION_KEYS = 2;
const SAFE_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

function secondsToMilliseconds(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TTL_SECONDS) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  return value * 1000;
}

function sessionView(session: StoredBrowserSession): Readonly<BrowserSessionView> {
  return Object.freeze({
    authenticatedAt: new Date(session.authenticatedAtMs).toISOString(),
    client: "pc-web",
    csrfToken: session.csrfToken,
    expiresAt: new Date(session.absoluteExpiresAtMs).toISOString(),
  });
}

function stateFromCallback(callbackUrl: string): string {
  try {
    const state = new URL(callbackUrl).searchParams.get("state");
    if (!state) throw new Error("Missing state.");
    return state;
  } catch {
    throw new BrowserSessionFailure("authentication_callback_invalid");
  }
}

function remainingSessionTtl(session: StoredBrowserSession, nowMs: number, idleTtlMs: number): number {
  const remaining = session.absoluteExpiresAtMs - nowMs;
  if (remaining <= 0) throw new BrowserSessionFailure("authentication_session_invalid");
  return Math.min(remaining, idleTtlMs);
}

async function auditOrFail(audit: AuthenticationAuditPort, event: AuthenticationAuditEvent): Promise<void> {
  try {
    await audit.record(event);
  } catch {
    throw new BrowserSessionFailure("authentication_dependency_unavailable");
  }
}

function auditOperationId(action: AuthenticationAuditAction, logicalReference: string): string {
  const bytes = createHash("sha256")
    .update("ai-crm:pc-bff:authentication-audit:v1\0", "utf8")
    .update(action, "utf8")
    .update("\0", "utf8")
    .update(logicalReference, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function authenticationAuditEvent(
  action: AuthenticationAuditAction,
  logicalReference: string,
  traceId: string,
  sessionReference?: string,
): AuthenticationAuditEvent {
  return Object.freeze({
    action,
    operationId: auditOperationId(action, logicalReference),
    result: "succeeded",
    ...(sessionReference === undefined ? {} : { sessionReference }),
    traceId,
  });
}

function snapshotKeyring(options: PcBffSessionServiceOptions): Readonly<{
  decryptionKeys: readonly Readonly<KeyEncryptionKey>[];
  encryptionKey: Readonly<KeyEncryptionKey>;
  indexingKey: Uint8Array;
}> {
  const keys = options.decryptionKeys;
  const validKey = (key: KeyEncryptionKey) => SAFE_KEY_ID.test(key.id) && key.value.byteLength === 32;
  if (!validKey(options.encryptionKey) || keys.length === 0 || keys.length > MAX_DECRYPTION_KEYS ||
    keys.some((key) => !validKey(key)) || options.indexingKey.byteLength < 32) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  const currentMatches = keys.filter((key) => key.id === options.encryptionKey.id &&
    timingSafeEqual(key.value, options.encryptionKey.value));
  const uniqueIds = new Set(keys.map((key) => key.id));
  const uniqueValues = keys.every((key, index) => keys.every((candidate, candidateIndex) =>
    index === candidateIndex || !timingSafeEqual(key.value, candidate.value)));
  const indexingKeyReused = keys.some((key) => options.indexingKey.byteLength === key.value.byteLength &&
    timingSafeEqual(options.indexingKey, key.value));
  if (currentMatches.length !== 1 || uniqueIds.size !== keys.length || !uniqueValues || indexingKeyReused) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  const decryptionKeys = Object.freeze(keys.map((key) => Object.freeze({
    id: key.id,
    value: new Uint8Array(key.value),
  })));
  const encryptionKey = decryptionKeys.find((key) => key.id === options.encryptionKey.id &&
    timingSafeEqual(key.value, options.encryptionKey.value));
  if (encryptionKey === undefined) throw new BrowserSessionFailure("authentication_session_invalid");
  return Object.freeze({
    decryptionKeys,
    encryptionKey,
    indexingKey: new Uint8Array(options.indexingKey),
  });
}

async function verifyIssuedAccessToken(
  verifier: TokenVerifier,
  accessToken: string,
): Promise<void> {
  try {
    await verifier.verify(accessToken);
  } catch (error) {
    if (error instanceof AuthenticationFailure && error.code === "identity_provider_unavailable") {
      throw new BrowserSessionFailure("authentication_dependency_unavailable");
    }
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
}

export function createPcBffSessionService(
  options: PcBffSessionServiceOptions,
): Readonly<PcBffSessionService> {
  const securityKeys = snapshotKeyring(options);
  const now = options.clock ?? Date.now;
  const loginTtlMs = secondsToMilliseconds(options.loginTransactionTtlSeconds);
  const idleTtlMs = secondsToMilliseconds(options.sessionIdleTtlSeconds);
  const absoluteTtlMs = secondsToMilliseconds(options.sessionAbsoluteTtlSeconds);
  if (absoluteTtlMs < idleTtlMs || options.refreshLeaseTtlMs <= 0) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }

  async function loadVerifiedSession(credential: string): Promise<{
    readonly principal: Readonly<AuthenticatedPrincipal>;
    readonly session: Readonly<StoredBrowserSession>;
  }> {
    const timestamp = now();
    const sessionIndex = createSessionIndex(credential, securityKeys.indexingKey);
    const session = await options.store.getSession(sessionIndex, idleTtlMs, timestamp);
    if (!session || session.absoluteExpiresAtMs <= timestamp) {
      throw new BrowserSessionFailure("authentication_session_invalid");
    }
    try {
      const tokens = decryptSessionTokens(session.tokens, securityKeys.decryptionKeys, session.id);
      const principal = await options.tokenVerifier.verify(tokens.accessToken);
      return Object.freeze({ principal, session });
    } catch (error) {
      if (error instanceof AuthenticationFailure && error.code === "identity_provider_unavailable") {
        throw new BrowserSessionFailure("authentication_dependency_unavailable");
      }
      await options.store.deleteSession(sessionIndex);
      throw new BrowserSessionFailure("authentication_session_invalid");
    }
  }

  async function loadStoredSession(credential: string): Promise<Readonly<StoredBrowserSession>> {
    const timestamp = now();
    const sessionIndex = createSessionIndex(credential, securityKeys.indexingKey);
    const session = await options.store.getSession(sessionIndex, idleTtlMs, timestamp);
    if (!session || session.absoluteExpiresAtMs <= timestamp) {
      throw new BrowserSessionFailure("authentication_session_invalid");
    }
    return session;
  }

  return Object.freeze({
    async beginLogin(returnTo: string): Promise<Readonly<LoginRedirect>> {
      const traceId = createTraceContext().traceId;
      const result = await options.oidc.beginLogin(returnTo);
      const stateIndex = createSessionIndex(result.transaction.state, securityKeys.indexingKey);
      await options.store.storeLoginTransaction(stateIndex, result.transaction, loginTtlMs);
      try {
        await auditOrFail(options.audit, authenticationAuditEvent("login_started", stateIndex, traceId));
      } catch (error) {
        await options.store.consumeLoginTransaction(stateIndex);
        throw error;
      }
      return Object.freeze({ authorizationUrl: result.authorizationUrl });
    },

    async completeLogin(callbackUrl: string): Promise<Readonly<CompletedLogin>> {
      const traceId = createTraceContext().traceId;
      const state = stateFromCallback(callbackUrl);
      let stateIndex: string;
      try {
        stateIndex = createSessionIndex(state, securityKeys.indexingKey);
      } catch {
        throw new BrowserSessionFailure("authentication_callback_invalid");
      }
      const transaction = await options.store.consumeLoginTransaction(stateIndex);
      if (!transaction) throw new BrowserSessionFailure("authentication_callback_invalid");
      const tokenResult = await options.oidc.exchangeCallback(callbackUrl, transaction);
      await verifyIssuedAccessToken(options.tokenVerifier, tokenResult.tokens.accessToken);
      const timestamp = now();
      const credential = createOpaqueCredential();
      const sessionIndex = createSessionIndex(credential, securityKeys.indexingKey);
      const sessionReference = createOpaqueCredential();
      const session: StoredBrowserSession = Object.freeze({
        absoluteExpiresAtMs: timestamp + absoluteTtlMs,
        authenticatedAtMs: tokenResult.authenticatedAtMs,
        createdAtMs: timestamp,
        csrfToken: createOpaqueCredential(),
        id: sessionReference,
        revision: 0,
        tokens: encryptSessionTokens(tokenResult.tokens, securityKeys.encryptionKey, sessionReference),
      });
      await options.store.createSession(sessionIndex, session, idleTtlMs);
      try {
        await auditOrFail(options.audit,
          authenticationAuditEvent("login_completed", session.id, traceId, session.id));
      } catch (error) {
        await options.store.deleteSession(sessionIndex);
        throw error;
      }
      return Object.freeze({ credential, returnTo: transaction.returnTo, session: sessionView(session) });
    },

    async currentSession(credential: string): Promise<Readonly<BrowserSessionView>> {
      return sessionView((await loadVerifiedSession(credential)).session);
    },

    async logout(credential: string | undefined, expectedSessionReference?: string): Promise<Readonly<LogoutResult>> {
      if (credential === undefined) return Object.freeze({});
      const traceId = createTraceContext().traceId;
      const sessionIndex = createSessionIndex(credential, securityKeys.indexingKey);
      const current = expectedSessionReference === undefined
        ? await options.store.getSession(sessionIndex, idleTtlMs, now())
        : undefined;
      const sessionReference = expectedSessionReference ?? current?.id;
      if (sessionReference === undefined) return Object.freeze({});
      await auditOrFail(options.audit,
        authenticationAuditEvent("session_logout_requested", sessionReference, traceId, sessionReference));
      const session = await options.store.revokeSession(sessionIndex, sessionReference);
      if (!session) return Object.freeze({});
      const endSessionUrl = options.oidc.endSessionUrl();
      return Object.freeze(endSessionUrl === undefined ? {} : { endSessionUrl });
    },

    async refresh(credential: string): Promise<Readonly<RefreshedSession>> {
      const traceId = createTraceContext().traceId;
      const previousIndex = createSessionIndex(credential, securityKeys.indexingKey);
      const initial = await options.store.getSession(previousIndex, idleTtlMs, now());
      if (!initial) throw new BrowserSessionFailure("authentication_session_invalid");
      const leaseOwner = createOpaqueCredential();
      if (!await options.store.acquireRefreshLease(initial.id, leaseOwner, options.refreshLeaseTtlMs)) {
        throw new BrowserSessionFailure("authentication_refresh_in_progress");
      }
      try {
        const timestamp = now();
        const current = await options.store.getSession(previousIndex, idleTtlMs, timestamp);
        if (!current || current.id !== initial.id || current.revision !== initial.revision) {
          throw new BrowserSessionFailure("authentication_session_invalid");
        }
        const tokens = decryptSessionTokens(current.tokens, securityKeys.decryptionKeys, current.id);
        const refreshed = await options.oidc.refresh(tokens);
        await verifyIssuedAccessToken(options.tokenVerifier, refreshed.tokens.accessToken);
        const nextCredential = createOpaqueCredential();
        const nextIndex = createSessionIndex(nextCredential, securityKeys.indexingKey);
        const nextSession: StoredBrowserSession = Object.freeze({
          ...current,
          revision: current.revision + 1,
          tokens: encryptSessionTokens(refreshed.tokens, securityKeys.encryptionKey, current.id),
        });
        const rotated = await options.store.rotateSession(
          previousIndex,
          nextIndex,
          current.revision,
          nextSession,
          remainingSessionTtl(nextSession, timestamp, idleTtlMs),
        );
        if (!rotated) throw new BrowserSessionFailure("authentication_session_invalid");
        try {
          await auditOrFail(options.audit, authenticationAuditEvent(
            "session_refreshed", `${current.id}:${String(nextSession.revision)}`, traceId, current.id,
          ));
        } catch (error) {
          await options.store.deleteSession(nextIndex);
          throw error;
        }
        return Object.freeze({ credential: nextCredential, session: sessionView(nextSession) });
      } finally {
        // The lease is an optimization with a bounded TTL. Cleanup failure must not
        // replace the refresh result (or its primary failure) after state rotation.
        await options.store.releaseRefreshLease(initial.id, leaseOwner).catch(() => undefined);
      }
    },

    async resolvePrincipal(credential: string): Promise<Readonly<AuthenticatedPrincipal>> {
      return (await loadVerifiedSession(credential)).principal;
    },

    async sessionForMutation(credential: string): Promise<Readonly<BrowserMutationSession>> {
      const session = await loadStoredSession(credential);
      return Object.freeze({ ...sessionView(session), sessionReference: session.id });
    },
  });
}
