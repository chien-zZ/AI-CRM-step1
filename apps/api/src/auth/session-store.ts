import { createClient } from "redis";

import { BrowserSessionFailure } from "./errors.js";
import type { LoginTransaction } from "./oidc.js";
import type { EncryptedSessionTokenSet } from "./session-security.js";

export interface StoredBrowserSession {
  readonly absoluteExpiresAtMs: number;
  readonly authenticatedAtMs: number;
  readonly createdAtMs: number;
  readonly csrfToken: string;
  readonly id: string;
  readonly revision: number;
  readonly tokens: Readonly<EncryptedSessionTokenSet>;
}

export interface BrowserSessionStore {
  acquireRefreshLease(sessionId: string, owner: string, ttlMs: number): Promise<boolean>;
  consumeLoginTransaction(stateIndex: string): Promise<Readonly<LoginTransaction> | undefined>;
  createSession(sessionIndex: string, session: StoredBrowserSession, ttlMs: number): Promise<void>;
  deleteSession(sessionIndex: string): Promise<Readonly<StoredBrowserSession> | undefined>;
  getSession(sessionIndex: string, idleTtlMs: number, nowMs: number): Promise<Readonly<StoredBrowserSession> | undefined>;
  revokeSession(sessionIndex: string, sessionId: string): Promise<Readonly<StoredBrowserSession> | undefined>;
  releaseRefreshLease(sessionId: string, owner: string): Promise<void>;
  rotateSession(
    previousIndex: string,
    nextIndex: string,
    expectedRevision: number,
    session: StoredBrowserSession,
    ttlMs: number,
  ): Promise<boolean>;
  storeLoginTransaction(stateIndex: string, transaction: LoginTransaction, ttlMs: number): Promise<void>;
}

export interface RedisCommandExecutor {
  sendCommand(arguments_: readonly string[]): Promise<unknown>;
}

export interface RedisSessionConnection {
  readonly executor: RedisCommandExecutor;
  close(): Promise<void>;
  isReady(): boolean;
}

export interface RedisSessionConnectionConfig {
  readonly connectTimeoutMs: number;
  readonly password: string;
  readonly signal?: AbortSignal;
  readonly url: string;
}

const SESSION_INDEX = /^[A-Za-z0-9_-]{43}$/u;
const RANDOM_ID = /^[A-Za-z0-9_-]{43}$/u;
const MAX_RECORD_BYTES = 65_536;

const touchScript = [
  "local value = redis.call('GET', KEYS[1])",
  "if not value then return false end",
  "local record = cjson.decode(value)",
  "local familyKey = 'ai-crm:auth:pc:family:' .. record.id",
  "local remaining = tonumber(record.absoluteExpiresAtMs) - tonumber(ARGV[2])",
  "if remaining <= 0 then",
  "  redis.call('DEL', KEYS[1])",
  "  if redis.call('GET', familyKey) == ARGV[3] then redis.call('DEL', familyKey) end",
  "  return false",
  "end",
  "local ttl = math.min(tonumber(ARGV[1]), remaining)",
  "if redis.call('GET', familyKey) ~= ARGV[3] then return false end",
  "redis.call('PEXPIRE', KEYS[1], ttl)",
  "redis.call('PEXPIRE', familyKey, ttl)",
  "return value",
].join("\n");

const createScript = [
  "if redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[2]) == 1 then return 0 end",
  "redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])",
  "redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])",
  "return 1",
].join("\n");

const deleteScript = [
  "local value = redis.call('GET', KEYS[1])",
  "if not value then return false end",
  "local record = cjson.decode(value)",
  "local familyKey = 'ai-crm:auth:pc:family:' .. record.id",
  "if redis.call('GET', familyKey) == ARGV[1] then redis.call('DEL', familyKey) end",
  "redis.call('DEL', KEYS[1])",
  "return value",
].join("\n");

const rotateScript = [
  "if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end",
  "local value = redis.call('GET', KEYS[1])",
  "if not value then return 0 end",
  "local record = cjson.decode(value)",
  "if tonumber(record.revision) ~= tonumber(ARGV[1]) then return 0 end",
  "local nextRecord = cjson.decode(ARGV[2])",
  "if nextRecord.id ~= record.id then return 0 end",
  "local familyKey = 'ai-crm:auth:pc:family:' .. record.id",
  "if redis.call('GET', familyKey) ~= ARGV[4] then return 0 end",
  "redis.call('DEL', KEYS[1])",
  "redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3], 'NX')",
  "redis.call('SET', familyKey, ARGV[5], 'PX', ARGV[3])",
  "return 1",
].join("\n");

const revokeScript = [
  "local currentIndex = redis.call('GET', KEYS[2])",
  "if not currentIndex then return false end",
  "local currentKey = 'ai-crm:auth:pc:session:' .. currentIndex",
  "local value = redis.call('GET', currentKey)",
  "if not value then redis.call('DEL', KEYS[2]); return false end",
  "local record = cjson.decode(value)",
  "if record.id ~= ARGV[1] then return false end",
  "redis.call('DEL', currentKey)",
  "redis.call('DEL', KEYS[2])",
  "return value or false",
].join("\n");

const releaseLeaseScript = [
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end",
  "return 0",
].join("\n");

function key(prefix: string, identifier: string): string {
  if (!SESSION_INDEX.test(identifier)) throw new BrowserSessionFailure("authentication_session_invalid");
  return `ai-crm:auth:pc:${prefix}:${identifier}`;
}

function leaseKey(sessionId: string): string {
  if (!RANDOM_ID.test(sessionId)) throw new BrowserSessionFailure("authentication_session_invalid");
  return `ai-crm:auth:pc:refresh:${sessionId}`;
}

function familyKey(sessionId: string): string {
  if (!RANDOM_ID.test(sessionId)) throw new BrowserSessionFailure("authentication_session_invalid");
  return `ai-crm:auth:pc:family:${sessionId}`;
}

function positiveMilliseconds(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 31_536_000_000) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  return String(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_RECORD_BYTES) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object";
}

function parseLoginTransaction(value: unknown): Readonly<LoginTransaction> {
  const parsed = parseJson(value);
  if (!isRecord(parsed) || typeof parsed["codeVerifier"] !== "string" ||
    typeof parsed["nonce"] !== "string" || typeof parsed["returnTo"] !== "string" ||
    typeof parsed["state"] !== "string" || !RANDOM_ID.test(parsed["state"]) ||
    parsed["codeVerifier"].length > 128 || parsed["nonce"].length > 128 ||
    parsed["returnTo"].length > 512) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  return Object.freeze({
    codeVerifier: parsed["codeVerifier"],
    nonce: parsed["nonce"],
    returnTo: parsed["returnTo"],
    state: parsed["state"],
  });
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseStoredSession(value: unknown): Readonly<StoredBrowserSession> {
  const parsed = parseJson(value);
  if (!isRecord(parsed) || !safeInteger(parsed["absoluteExpiresAtMs"]) ||
    !safeInteger(parsed["authenticatedAtMs"]) || !safeInteger(parsed["createdAtMs"]) ||
    typeof parsed["csrfToken"] !== "string" || !RANDOM_ID.test(parsed["csrfToken"]) ||
    typeof parsed["id"] !== "string" || !RANDOM_ID.test(parsed["id"]) ||
    !safeInteger(parsed["revision"]) || !isRecord(parsed["tokens"])) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  const tokens = parsed["tokens"];
  if (tokens["algorithm"] !== "A256GCM" || typeof tokens["ciphertext"] !== "string" ||
    typeof tokens["initializationVector"] !== "string" || typeof tokens["keyId"] !== "string" ||
    typeof tokens["tag"] !== "string" || (tokens["version"] !== 1 && tokens["version"] !== 2)) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  return Object.freeze({
    absoluteExpiresAtMs: parsed["absoluteExpiresAtMs"],
    authenticatedAtMs: parsed["authenticatedAtMs"],
    createdAtMs: parsed["createdAtMs"],
    csrfToken: parsed["csrfToken"],
    id: parsed["id"],
    revision: parsed["revision"],
    tokens: Object.freeze({
      algorithm: "A256GCM",
      ciphertext: tokens["ciphertext"],
      initializationVector: tokens["initializationVector"],
      keyId: tokens["keyId"],
      tag: tokens["tag"],
      version: tokens["version"],
    }),
  });
}

function stringResult(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new BrowserSessionFailure("authentication_dependency_unavailable");
  return value;
}

function commandSucceeded(value: unknown): boolean {
  return value === "OK" || value === 1;
}

export function createRedisBrowserSessionStore(
  executor: RedisCommandExecutor,
): Readonly<BrowserSessionStore> {
  return Object.freeze({
    async acquireRefreshLease(sessionId: string, owner: string, ttlMs: number): Promise<boolean> {
      if (!RANDOM_ID.test(owner)) throw new BrowserSessionFailure("authentication_session_invalid");
      const result = await executor.sendCommand([
        "SET", leaseKey(sessionId), owner, "PX", positiveMilliseconds(ttlMs), "NX",
      ]);
      return result === "OK";
    },

    async consumeLoginTransaction(stateIndex: string): Promise<Readonly<LoginTransaction> | undefined> {
      const value = stringResult(await executor.sendCommand(["GETDEL", key("login", stateIndex)]));
      return value === undefined ? undefined : parseLoginTransaction(value);
    },

    async createSession(sessionIndex: string, session: StoredBrowserSession, ttlMs: number): Promise<void> {
      const result = await executor.sendCommand([
        "EVAL",
        createScript,
        "2",
        key("session", sessionIndex),
        familyKey(session.id),
        JSON.stringify(session),
        sessionIndex,
        positiveMilliseconds(ttlMs),
      ]);
      if (!commandSucceeded(result)) throw new BrowserSessionFailure("authentication_session_invalid");
    },

    async deleteSession(sessionIndex: string): Promise<Readonly<StoredBrowserSession> | undefined> {
      const value = stringResult(await executor.sendCommand([
        "EVAL", deleteScript, "1", key("session", sessionIndex), sessionIndex,
      ]));
      return value === undefined ? undefined : parseStoredSession(value);
    },

    async getSession(sessionIndex: string, idleTtlMs: number, nowMs: number): Promise<Readonly<StoredBrowserSession> | undefined> {
      if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new BrowserSessionFailure("authentication_session_invalid");
      const value = stringResult(await executor.sendCommand([
        "EVAL", touchScript, "1", key("session", sessionIndex), positiveMilliseconds(idleTtlMs), String(nowMs), sessionIndex,
      ]));
      return value === undefined ? undefined : parseStoredSession(value);
    },

    async releaseRefreshLease(sessionId: string, owner: string): Promise<void> {
      if (!RANDOM_ID.test(owner)) return;
      await executor.sendCommand(["EVAL", releaseLeaseScript, "1", leaseKey(sessionId), owner]);
    },

    async revokeSession(sessionIndex: string, sessionId: string): Promise<Readonly<StoredBrowserSession> | undefined> {
      const value = stringResult(await executor.sendCommand([
        "EVAL", revokeScript, "2", key("session", sessionIndex), familyKey(sessionId), sessionId,
      ]));
      return value === undefined ? undefined : parseStoredSession(value);
    },

    async rotateSession(
      previousIndex: string,
      nextIndex: string,
      expectedRevision: number,
      session: StoredBrowserSession,
      ttlMs: number,
    ): Promise<boolean> {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw new BrowserSessionFailure("authentication_session_invalid");
      }
      const result = await executor.sendCommand([
        "EVAL",
        rotateScript,
        "2",
        key("session", previousIndex),
        key("session", nextIndex),
        String(expectedRevision),
        JSON.stringify(session),
        positiveMilliseconds(ttlMs),
        previousIndex,
        nextIndex,
      ]);
      return result === 1;
    },

    async storeLoginTransaction(stateIndex: string, transaction: LoginTransaction, ttlMs: number): Promise<void> {
      const result = await executor.sendCommand([
        "SET", key("login", stateIndex), JSON.stringify(transaction), "PX", positiveMilliseconds(ttlMs), "NX",
      ]);
      if (!commandSucceeded(result)) throw new BrowserSessionFailure("authentication_session_invalid");
    },
  });
}

export async function connectRedisSessionStore(
  config: RedisSessionConnectionConfig,
): Promise<Readonly<RedisSessionConnection>> {
  const client = createClient({
    password: config.password,
    socket: { connectTimeout: config.connectTimeoutMs, reconnectStrategy: false },
    url: config.url,
  });
  client.on("error", () => undefined);
  const abort = (): void => { client.destroy(); };
  if (config.signal?.aborted) {
    client.destroy();
    throw new BrowserSessionFailure("authentication_dependency_unavailable");
  }
  config.signal?.addEventListener("abort", abort, { once: true });
  try {
    await client.connect();
  } catch {
    client.destroy();
    throw new BrowserSessionFailure("authentication_dependency_unavailable");
  } finally {
    config.signal?.removeEventListener("abort", abort);
  }
  const executor: RedisCommandExecutor = {
    async sendCommand(arguments_: readonly string[]): Promise<unknown> {
      try {
        return await client.sendCommand([...arguments_]);
      } catch {
        throw new BrowserSessionFailure("authentication_dependency_unavailable");
      }
    },
  };
  return Object.freeze({
    async close(): Promise<void> {
      if (client.isOpen) await client.close();
    },
    executor,
    isReady: () => client.isReady,
  });
}
