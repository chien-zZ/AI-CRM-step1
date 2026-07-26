import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LoginTransaction } from "./oidc.js";
import {
  connectRedisSessionStore,
  createRedisBrowserSessionStore,
  type BrowserSessionStore,
  type RedisSessionConnection,
  type StoredBrowserSession,
} from "./session-store.js";

const redisUrl = process.env.TEST_AUTH_REDIS_URL;
const redisPasswordFile = process.env.TEST_AUTH_REDIS_PASSWORD_FILE;
const enabled = Boolean(redisUrl && redisPasswordFile);

const firstIndex = "a".repeat(43);
const secondIndex = "b".repeat(43);
const stateIndex = "c".repeat(43);
const sessionId = "d".repeat(43);
const firstOwner = "e".repeat(43);
const secondOwner = "f".repeat(43);

const transaction: LoginTransaction = Object.freeze({
  codeVerifier: "v".repeat(43),
  nonce: "n".repeat(43),
  returnTo: "/tasks",
  state: "s".repeat(43),
});

function session(revision: number, absoluteExpiresAtMs: number): StoredBrowserSession {
  return Object.freeze({
    absoluteExpiresAtMs,
    authenticatedAtMs: Date.now(),
    createdAtMs: Date.now(),
    csrfToken: "g".repeat(43),
    id: sessionId,
    revision,
    tokens: Object.freeze({
      algorithm: "A256GCM",
      ciphertext: "synthetic-ciphertext",
      initializationVector: "synthetic-initialization-vector",
      keyId: "test-key",
      tag: "synthetic-authentication-tag",
      version: 1,
    }),
  });
}

describe.skipIf(!enabled)("Redis browser session store integration", () => {
  let connection: Readonly<RedisSessionConnection>;
  let cleanupConnection: Readonly<RedisSessionConnection> | undefined;
  let store: Readonly<BrowserSessionStore>;

  beforeAll(async () => {
    if (!redisUrl || !redisPasswordFile) {
      throw new Error("Both TEST_AUTH_REDIS_URL and TEST_AUTH_REDIS_PASSWORD_FILE are required.");
    }
    const password = (await readFile(resolve(redisPasswordFile), "utf8")).trim();
    connection = await connectRedisSessionStore({ connectTimeoutMs: 2_000, password, url: redisUrl });
    cleanupConnection = connection;
    store = createRedisBrowserSessionStore(connection.executor);
    expect(connection.isReady()).toBe(true);
  });

  afterAll(async () => {
    await cleanupConnection?.close();
  });

  it("consumes login transactions exactly once and rejects duplicate creation", async () => {
    await store.storeLoginTransaction(stateIndex, transaction, 10_000);
    await expect(store.storeLoginTransaction(stateIndex, transaction, 10_000)).rejects.toMatchObject({
      code: "authentication_session_invalid",
    });
    await expect(store.consumeLoginTransaction(stateIndex)).resolves.toEqual(transaction);
    await expect(store.consumeLoginTransaction(stateIndex)).resolves.toBeUndefined();
  });

  it("touches TTL within the absolute limit and removes an absolutely expired session", async () => {
    const now = Date.now();
    await store.createSession(firstIndex, session(0, now + 10_000), 10_000);
    await expect(store.getSession(firstIndex, 2_000, now)).resolves.toMatchObject({ revision: 0 });

    await store.deleteSession(firstIndex);
    await store.createSession(firstIndex, session(0, now - 1), 10_000);
    await expect(store.getSession(firstIndex, 2_000, now)).resolves.toBeUndefined();
    await expect(store.deleteSession(firstIndex)).resolves.toBeUndefined();
  });

  it("rotates only the expected revision and invalidates the previous index", async () => {
    const now = Date.now();
    await store.createSession(firstIndex, session(0, now + 10_000), 10_000);
    await expect(store.rotateSession(firstIndex, secondIndex, 1, session(1, now + 10_000), 10_000))
      .resolves.toBe(false);
    await expect(store.rotateSession(firstIndex, secondIndex, 0, session(1, now + 10_000), 10_000))
      .resolves.toBe(true);
    await expect(store.getSession(firstIndex, 2_000, now)).resolves.toBeUndefined();
    await expect(store.getSession(secondIndex, 2_000, now)).resolves.toMatchObject({ revision: 1 });
    await expect(store.revokeSession(firstIndex, sessionId)).resolves.toMatchObject({ revision: 1 });
    await expect(store.getSession(secondIndex, 2_000, now)).resolves.toBeUndefined();
  });

  it("releases a refresh lease only for its owner", async () => {
    await expect(store.acquireRefreshLease(sessionId, firstOwner, 10_000)).resolves.toBe(true);
    await expect(store.acquireRefreshLease(sessionId, secondOwner, 10_000)).resolves.toBe(false);
    await store.releaseRefreshLease(sessionId, secondOwner);
    await expect(store.acquireRefreshLease(sessionId, secondOwner, 10_000)).resolves.toBe(false);
    await store.releaseRefreshLease(sessionId, firstOwner);
    await expect(store.acquireRefreshLease(sessionId, secondOwner, 10_000)).resolves.toBe(true);
    await store.releaseRefreshLease(sessionId, secondOwner);
  });
});
