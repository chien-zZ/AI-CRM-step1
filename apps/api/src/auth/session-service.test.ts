import { randomBytes } from "node:crypto";

import {
  AuthenticationFailure,
  type AuthenticatedPrincipal,
  type TokenVerifier,
} from "@ai-crm/platform-auth-context";
import { beforeEach, describe, expect, it } from "vitest";

import { BrowserSessionFailure } from "./errors.js";
import type { LoginTransaction, OidcClientPort, OidcTokenResult } from "./oidc.js";
import { createSessionIndex, type KeyEncryptionKey, type SessionTokenSet } from "./session-security.js";
import {
  createPcBffSessionService,
  type AuthenticationAuditEvent,
  type AuthenticationAuditPort,
  type PcBffSessionServiceOptions,
} from "./session-service.js";
import type { BrowserSessionStore, StoredBrowserSession } from "./session-store.js";

const state = "s".repeat(43);
const transaction: LoginTransaction = Object.freeze({
  codeVerifier: "v".repeat(43),
  nonce: "n".repeat(43),
  returnTo: "/tasks",
  state,
});
const initialTokens: SessionTokenSet = Object.freeze({
  accessToken: "access.initial",
  idToken: "identity.initial",
  refreshToken: "refresh.initial",
});
const refreshedTokens: SessionTokenSet = Object.freeze({
  accessToken: "access.refreshed",
  idToken: "identity.refreshed",
  refreshToken: "refresh.refreshed",
});

class MemoryStore implements BrowserSessionStore {
  readonly families = new Map<string, string>();
  readonly leases = new Map<string, string>();
  readonly sessions = new Map<string, StoredBrowserSession>();
  readonly transactions = new Map<string, LoginTransaction>();
  allowLease = true;
  releaseLeaseFailure: Error | undefined;

  acquireRefreshLease(sessionId: string, owner: string): Promise<boolean> {
    if (!this.allowLease || this.leases.has(sessionId)) return Promise.resolve(false);
    this.leases.set(sessionId, owner);
    return Promise.resolve(true);
  }

  consumeLoginTransaction(stateIndex: string): Promise<Readonly<LoginTransaction> | undefined> {
    const value = this.transactions.get(stateIndex);
    this.transactions.delete(stateIndex);
    return Promise.resolve(value);
  }

  createSession(sessionIndex: string, session: StoredBrowserSession): Promise<void> {
    if (this.sessions.has(sessionIndex) || this.families.has(session.id)) {
      return Promise.reject(new BrowserSessionFailure("authentication_session_invalid"));
    }
    this.sessions.set(sessionIndex, session);
    this.families.set(session.id, sessionIndex);
    return Promise.resolve();
  }

  deleteSession(sessionIndex: string): Promise<Readonly<StoredBrowserSession> | undefined> {
    const value = this.sessions.get(sessionIndex);
    this.sessions.delete(sessionIndex);
    if (value && this.families.get(value.id) === sessionIndex) this.families.delete(value.id);
    return Promise.resolve(value);
  }

  getSession(sessionIndex: string): Promise<Readonly<StoredBrowserSession> | undefined> {
    return Promise.resolve(this.sessions.get(sessionIndex));
  }

  releaseRefreshLease(sessionId: string, owner: string): Promise<void> {
    if (this.releaseLeaseFailure !== undefined) return Promise.reject(this.releaseLeaseFailure);
    if (this.leases.get(sessionId) === owner) this.leases.delete(sessionId);
    return Promise.resolve();
  }

  revokeSession(_sessionIndex: string, sessionId: string): Promise<Readonly<StoredBrowserSession> | undefined> {
    const currentIndex = this.families.get(sessionId);
    if (!currentIndex) return Promise.resolve(undefined);
    const value = this.sessions.get(currentIndex);
    this.sessions.delete(currentIndex);
    this.families.delete(sessionId);
    return Promise.resolve(value);
  }

  rotateSession(
    previousIndex: string,
    nextIndex: string,
    expectedRevision: number,
    session: StoredBrowserSession,
  ): Promise<boolean> {
    const previous = this.sessions.get(previousIndex);
    if (!previous || previous.revision !== expectedRevision || this.sessions.has(nextIndex)) return Promise.resolve(false);
    this.sessions.delete(previousIndex);
    this.sessions.set(nextIndex, session);
    this.families.set(session.id, nextIndex);
    return Promise.resolve(true);
  }

  storeLoginTransaction(stateIndex: string, value: LoginTransaction): Promise<void> {
    this.transactions.set(stateIndex, value);
    return Promise.resolve();
  }
}

class FakeOidc implements OidcClientPort {
  refreshCalls = 0;

  beginLogin(): Promise<{ authorizationUrl: string; transaction: LoginTransaction }> {
    return Promise.resolve({ authorizationUrl: "https://identity.example.test/authorize", transaction });
  }

  endSessionUrl(): string | undefined {
    return "https://identity.example.test/logout";
  }

  exchangeCallback(): Promise<Readonly<OidcTokenResult>> {
    return Promise.resolve(Object.freeze({ authenticatedAtMs: 1_000, expiresInSeconds: 300, tokens: initialTokens }));
  }

  refresh(): Promise<Readonly<OidcTokenResult>> {
    this.refreshCalls += 1;
    return Promise.resolve(Object.freeze({ authenticatedAtMs: 1_000, expiresInSeconds: 300, tokens: refreshedTokens }));
  }
}

class MemoryAudit implements AuthenticationAuditPort {
  readonly events: AuthenticationAuditEvent[] = [];
  fail = false;

  record(event: AuthenticationAuditEvent): Promise<void> {
    if (this.fail) return Promise.reject(new Error("Synthetic audit failure."));
    this.events.push(event);
    return Promise.resolve();
  }
}

class FakeTokenVerifier implements TokenVerifier {
  failure: AuthenticationFailure | undefined;

  verify(): Promise<Readonly<AuthenticatedPrincipal>> {
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(Object.freeze({
      authenticationSubject: Object.freeze({
        issuer: "https://identity.example.test/realms/test",
        subject: "synthetic-subject",
      }),
      clientId: "ai-crm-pc-bff",
      expiresAt: "2026-07-24T13:00:00.000Z",
      issuedAt: "2026-07-24T12:00:00.000Z",
    }));
  }
}

let store: MemoryStore;
let oidc: FakeOidc;
let audit: MemoryAudit;
let encryptionKey: KeyEncryptionKey;
let tokenVerifier: FakeTokenVerifier;
let options: PcBffSessionServiceOptions;

beforeEach(() => {
  store = new MemoryStore();
  oidc = new FakeOidc();
  audit = new MemoryAudit();
  encryptionKey = { id: "session-key-1", value: randomBytes(32) };
  tokenVerifier = new FakeTokenVerifier();
  options = {
    audit,
    clock: () => 2_000,
    decryptionKeys: [encryptionKey],
    encryptionKey,
    indexingKey: randomBytes(32),
    loginTransactionTtlSeconds: 180,
    oidc,
    refreshLeaseTtlMs: 10_000,
    sessionAbsoluteTtlSeconds: 28_800,
    sessionIdleTtlSeconds: 1_800,
    store,
    tokenVerifier,
  };
});

describe("createPcBffSessionService", () => {
  it.each([
    ["an empty decryption keyring", () => ({ decryptionKeys: [] })],
    ["a keyring without the write key", () => ({
      decryptionKeys: [{ id: "other-key", value: randomBytes(32) }],
    })],
    ["duplicate key identifiers", () => ({
      decryptionKeys: [encryptionKey, { id: encryptionKey.id, value: randomBytes(32) }],
    })],
    ["duplicate key material", () => ({
      decryptionKeys: [encryptionKey, { id: "other-key", value: encryptionKey.value }],
    })],
    ["more than two decryption keys", () => ({
      decryptionKeys: [
        encryptionKey,
        { id: "old-key-1", value: randomBytes(32) },
        { id: "old-key-2", value: randomBytes(32) },
      ],
    })],
    ["indexing key material reused for encryption", () => ({ indexingKey: encryptionKey.value })],
  ])("fails closed for %s", (_name, invalid) => {
    let failure: unknown;
    try {
      createPcBffSessionService({ ...options, ...invalid() });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "authentication_session_invalid" });
  });

  it("snapshots mutable key material at the composition boundary", async () => {
    const originalIndexingKey = new Uint8Array(options.indexingKey);
    const service = createPcBffSessionService(options);
    encryptionKey.value.fill(0);
    options.indexingKey.fill(0);
    options.decryptionKeys[0]?.value.fill(0);

    await service.beginLogin("/tasks");
    const completed = await service.completeLogin(
      `https://workbench.example.test/auth/pc/callback?code=synthetic&state=${state}`,
    );
    expect(store.sessions.has(createSessionIndex(completed.credential, originalIndexingKey))).toBe(true);
    await expect(service.currentSession(completed.credential)).resolves.toMatchObject({ client: "pc-web" });
  });

  it("consumes the callback transaction once and creates a browser-safe session", async () => {
    const service = createPcBffSessionService(options);
    await service.beginLogin("/tasks");
    const completed = await service.completeLogin(`https://workbench.example.test/auth/pc/callback?code=synthetic&state=${state}`);

    expect(completed.returnTo).toBe("/tasks");
    expect(completed.session.client).toBe("pc-web");
    expect(completed.session).not.toHaveProperty("accessToken");
    await expect(service.completeLogin(`https://workbench.example.test/auth/pc/callback?code=replay&state=${state}`))
      .rejects.toMatchObject({ code: "authentication_callback_invalid" });
  });

  it("rotates the opaque credential and invalidates the old session on refresh", async () => {
    const service = createPcBffSessionService(options);
    await service.beginLogin("/tasks");
    const completed = await service.completeLogin(`https://workbench.example.test/auth/pc/callback?code=synthetic&state=${state}`);
    const refreshed = await service.refresh(completed.credential);

    expect(refreshed.credential).not.toBe(completed.credential);
    await expect(service.currentSession(completed.credential)).rejects.toMatchObject({
      code: "authentication_session_invalid",
    });
    await expect(service.currentSession(refreshed.credential)).resolves.toMatchObject({ client: "pc-web" });
    expect(oidc.refreshCalls).toBe(1);
  });

  it("does not replace a successful refresh when bounded lease cleanup fails", async () => {
    const service = createPcBffSessionService(options);
    await service.beginLogin("/tasks");
    const completed = await service.completeLogin(`https://workbench.example.test/auth/pc/callback?code=synthetic&state=${state}`);
    store.releaseLeaseFailure = new Error("synthetic lease cleanup failure");

    const refreshed = await service.refresh(completed.credential);
    await expect(service.currentSession(refreshed.credential)).resolves.toMatchObject({ client: "pc-web" });
  });

  it("reads an old encryption key and writes the current key during a bounded rotation window", async () => {
    const oldKey = encryptionKey;
    const oldService = createPcBffSessionService(options);
    await oldService.beginLogin("/tasks");
    const completed = await oldService.completeLogin(
      `https://workbench.example.test/auth/pc/callback?code=synthetic&state=${state}`,
    );
    const currentKey = { id: "session-key-2", value: randomBytes(32) };
    const rotatedService = createPcBffSessionService({
      ...options,
      decryptionKeys: [currentKey, oldKey],
      encryptionKey: currentKey,
    });

    await expect(rotatedService.currentSession(completed.credential)).resolves.toMatchObject({ client: "pc-web" });
    const refreshed = await rotatedService.refresh(completed.credential);
    const refreshedIndex = createSessionIndex(refreshed.credential, options.indexingKey);
    expect(store.sessions.get(refreshedIndex)?.tokens.keyId).toBe("session-key-2");
  });

  it("rejects concurrent refresh before using the Refresh Token", async () => {
    const service = createPcBffSessionService(options);
    await service.beginLogin("/tasks");
    const completed = await service.completeLogin(`https://workbench.example.test/auth/pc/callback?code=synthetic&state=${state}`);
    store.allowLease = false;

    await expect(service.refresh(completed.credential)).rejects.toMatchObject({
      code: "authentication_refresh_in_progress",
    });
    expect(oidc.refreshCalls).toBe(0);
  });

  it("does not persist a login session when the issued Access Token is invalid", async () => {
    const service = createPcBffSessionService(options);
    await service.beginLogin("/tasks");
    tokenVerifier.failure = new AuthenticationFailure("token_invalid");

    await expect(service.completeLogin(
      `https://workbench.example.test/auth/pc/callback?code=synthetic&state=${state}`,
    )).rejects.toMatchObject({ code: "authentication_session_invalid" });
    expect(store.sessions.size).toBe(0);
    expect(audit.events.some((event) => event.action === "login_completed")).toBe(false);
  });

  it("keeps the original local session when a refreshed Access Token is invalid", async () => {
    const service = createPcBffSessionService(options);
    await service.beginLogin("/tasks");
    const completed = await service.completeLogin(
      `https://workbench.example.test/auth/pc/callback?code=synthetic&state=${state}`,
    );
    const originalIndex = createSessionIndex(completed.credential, options.indexingKey);
    tokenVerifier.failure = new AuthenticationFailure("token_invalid");

    await expect(service.refresh(completed.credential)).rejects.toMatchObject({
      code: "authentication_session_invalid",
    });
    expect(store.sessions.has(originalIndex)).toBe(true);
    expect(audit.events.some((event) => event.action === "session_refreshed")).toBe(false);
    tokenVerifier.failure = undefined;
    await expect(service.currentSession(completed.credential)).resolves.toMatchObject({ client: "pc-web" });
  });

  it("revokes a newly created session when durable audit recording fails", async () => {
    const service = createPcBffSessionService(options);
    await service.beginLogin("/tasks");
    audit.fail = true;

    await expect(service.completeLogin(`https://workbench.example.test/auth/pc/callback?code=synthetic&state=${state}`))
      .rejects.toMatchObject({ code: "authentication_dependency_unavailable" });
    expect(store.sessions.size).toBe(0);
  });

  it("logs out locally before returning the provider end-session URL and remains idempotent", async () => {
    const service = createPcBffSessionService(options);
    await service.beginLogin("/tasks");
    const completed = await service.completeLogin(`https://workbench.example.test/auth/pc/callback?code=synthetic&state=${state}`);

    await expect(service.logout(completed.credential)).resolves.toEqual({
      endSessionUrl: "https://identity.example.test/logout",
    });
    await expect(service.logout(completed.credential)).resolves.toEqual({});
    expect(store.sessions.has(createSessionIndex(completed.credential, options.indexingKey))).toBe(false);
  });

  it("derives the same audit operation for repeated logout of one logical session", async () => {
    const service = createPcBffSessionService(options);
    await service.beginLogin("/tasks");
    const completed = await service.completeLogin(`https://workbench.example.test/auth/pc/callback?code=synthetic&state=${state}`);
    const mutation = await service.sessionForMutation(completed.credential);

    await service.logout(completed.credential, mutation.sessionReference);
    await service.logout(completed.credential, mutation.sessionReference);
    const events = audit.events.filter(({ action }) => action === "session_logout_requested");
    expect(events).toHaveLength(2);
    expect(events[0]?.operationId).toBe(events[1]?.operationId);
    expect(events.every(({ traceId }) => /^(?!0{32})[0-9a-f]{32}$/u.test(traceId))).toBe(true);
  });

  it("separates refresh audit operations by session revision", async () => {
    const service = createPcBffSessionService(options);
    await service.beginLogin("/tasks");
    const completed = await service.completeLogin(`https://workbench.example.test/auth/pc/callback?code=synthetic&state=${state}`);
    const first = await service.refresh(completed.credential);
    await service.refresh(first.credential);

    const events = audit.events.filter(({ action }) => action === "session_refreshed");
    expect(events).toHaveLength(2);
    expect(events[0]?.operationId).not.toBe(events[1]?.operationId);
  });

  it("revokes the rotated session when refresh wins the race with logout", async () => {
    const service = createPcBffSessionService(options);
    await service.beginLogin("/tasks");
    const completed = await service.completeLogin(`https://workbench.example.test/auth/pc/callback?code=synthetic&state=${state}`);
    const mutationSession = await service.sessionForMutation(completed.credential);
    const refreshed = await service.refresh(completed.credential);

    await expect(service.logout(completed.credential, mutationSession.sessionReference)).resolves.toEqual({
      endSessionUrl: "https://identity.example.test/logout",
    });
    await expect(service.currentSession(refreshed.credential)).rejects.toMatchObject({
      code: "authentication_session_invalid",
    });
  });

  it("leaves the session retryable when logout audit recording fails", async () => {
    const service = createPcBffSessionService(options);
    await service.beginLogin("/tasks");
    const completed = await service.completeLogin(`https://workbench.example.test/auth/pc/callback?code=synthetic&state=${state}`);
    const mutationSession = await service.sessionForMutation(completed.credential);
    audit.fail = true;

    await expect(service.logout(completed.credential, mutationSession.sessionReference)).rejects.toMatchObject({
      code: "authentication_dependency_unavailable",
    });
    audit.fail = false;
    await expect(service.currentSession(completed.credential)).resolves.toMatchObject({ client: "pc-web" });
    await expect(service.logout(completed.credential, mutationSession.sessionReference)).resolves.toHaveProperty("endSessionUrl");
  });

  it("resolves a principal only after server-side Access Token verification", async () => {
    const service = createPcBffSessionService(options);
    await service.beginLogin("/tasks");
    const completed = await service.completeLogin(`https://workbench.example.test/auth/pc/callback?code=synthetic&state=${state}`);

    await expect(service.resolvePrincipal(completed.credential)).resolves.toMatchObject({
      authenticationSubject: { subject: "synthetic-subject" },
    });
    tokenVerifier.failure = new AuthenticationFailure("token_invalid");
    await expect(service.resolvePrincipal(completed.credential)).rejects.toMatchObject({
      code: "authentication_session_invalid",
    });
    expect(store.sessions.size).toBe(0);
  });
});
