import { createHash } from "node:crypto";

import type {
  AuthorizationCache,
  AuthorizationDecisionReason,
  CachedAuthorizationEvaluation,
  DataScope,
  DataScopeTerm,
} from "./types.js";

interface RedisCommandExecutor {
  send(command: readonly string[]): Promise<unknown>;
}

interface RedisRuntimeClient {
  connect(): Promise<void>;
  destroy(): void;
  quit(): Promise<string>;
  sendCommand(command: readonly string[]): Promise<unknown>;
}

interface RedisRuntime {
  createClient(options: {
    readonly password: string;
    readonly socket: { readonly connectTimeout: number; readonly reconnectStrategy: false };
    readonly url: string;
  }): RedisRuntimeClient;
}

const REASONS = new Set<AuthorizationDecisionReason>([
  "allowed", "unknown_permission", "no_applicable_grant", "invalid_context",
  "resource_context_required", "scope_mismatch", "policy_unavailable", "policy_invalid",
]);
const IDENTIFIER = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;
const VALUE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,254}$/u;
const POLICY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseScope = (value: unknown): DataScope | undefined => {
  if (!isRecord(value) || value["version"] !== 1 || !Array.isArray(value["terms"]) ||
    value["terms"].length === 0 || value["terms"].length > 128) return undefined;
  const terms: DataScopeTerm[] = [];
  for (const term of value["terms"]) {
    if (!isRecord(term) || term["kind"] === undefined) return undefined;
    if (term["kind"] === "all" && Object.keys(term).length === 1) {
      terms.push({ kind: "all" });
      continue;
    }
    if (term["kind"] !== "match" || !Array.isArray(term["constraints"]) ||
      term["constraints"].length === 0 || term["constraints"].length > 32) return undefined;
    const constraints = [];
    for (const constraint of term["constraints"]) {
      if (!isRecord(constraint) || typeof constraint["dimension"] !== "string" ||
        !IDENTIFIER.test(constraint["dimension"]) || !Array.isArray(constraint["values"]) ||
        constraint["values"].length === 0 || constraint["values"].length > 256 ||
        constraint["values"].some((item) => typeof item !== "string" || !VALUE.test(item))) return undefined;
      constraints.push({ dimension: constraint["dimension"], values: constraint["values"] as string[] });
    }
    terms.push({ constraints, kind: "match" });
  }
  return { terms, version: 1 };
};

const parseEvaluation = (value: unknown): CachedAuthorizationEvaluation | undefined => {
  if (!isRecord(value) || typeof value["allowed"] !== "boolean" ||
    typeof value["policyVersion"] !== "string" || !POLICY_VERSION.test(value["policyVersion"]) ||
    typeof value["reason"] !== "string" || !REASONS.has(value["reason"] as AuthorizationDecisionReason)) return undefined;
  const reason = value["reason"] as AuthorizationDecisionReason;
  if ((value["allowed"] && reason !== "allowed") || (!value["allowed"] && reason === "allowed")) return undefined;
  const scope = value["scope"] === undefined ? undefined : parseScope(value["scope"]);
  if (value["scope"] !== undefined && scope === undefined) return undefined;
  return {
    allowed: value["allowed"],
    policyVersion: value["policyVersion"],
    reason,
    ...(scope === undefined ? {} : { scope }),
  };
};

const versionDigest = (version: string): string => createHash("sha256").update(version).digest("hex");

export const createRedisAuthorizationCache = (
  executor: RedisCommandExecutor,
  namespace: string,
): AuthorizationCache => {
  if (!/^[a-z][a-z0-9:-]{2,63}$/u.test(namespace)) throw new TypeError("AUTHORIZATION_INVALID_CACHE_OPTIONS");
  const decisionKey = (key: string): string => `${namespace}:decision:${key}`;
  const versionKey = (version: string): string => `${namespace}:version:${versionDigest(version)}`;
  const cache: AuthorizationCache = {
    async get(key) {
      if (!/^[a-f0-9]{64}$/u.test(key)) throw new TypeError("AUTHORIZATION_INVALID_CACHE_KEY");
      const raw = await executor.send(["GET", decisionKey(key)]);
      if (typeof raw !== "string") return undefined;
      try {
        return parseEvaluation(JSON.parse(raw));
      } catch {
        return undefined;
      }
    },
    async invalidatePolicyVersion(version) {
      const index = versionKey(version);
      const members = await executor.send(["SMEMBERS", index]);
      if (Array.isArray(members) && members.length > 0 && members.length <= 10_000 &&
        members.every((member) => typeof member === "string" && member.startsWith(`${namespace}:decision:`))) {
        for (let offset = 0; offset < members.length; offset += 256) {
          await executor.send(["DEL", ...members.slice(offset, offset + 256) as string[]]);
        }
      }
      await executor.send(["DEL", index]);
    },
    async set(key, value, ttlSeconds, version) {
      if (!/^[a-f0-9]{64}$/u.test(key) || !Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 86_400) {
        throw new TypeError("AUTHORIZATION_INVALID_CACHE_KEY");
      }
      const target = decisionKey(key);
      const index = versionKey(version);
      await executor.send(["SET", target, JSON.stringify(value), "EX", String(ttlSeconds)]);
      await executor.send(["SADD", index, target]);
      await executor.send(["EXPIRE", index, String(Math.min(86_400, ttlSeconds + 60))]);
    },
  };
  return Object.freeze(cache);
};

export interface RedisAuthorizationCacheOptions {
  readonly allowInsecureDevelopment?: boolean;
  readonly connectTimeoutMilliseconds: number;
  readonly namespace: string;
  readonly password: string;
  readonly url: string;
}

export interface ConnectedAuthorizationCache {
  readonly cache: AuthorizationCache;
  close(): Promise<void>;
}

async function importRuntime(specifier: string): Promise<unknown> {
  return import(specifier);
}

export const connectRedisAuthorizationCache = async (
  options: RedisAuthorizationCacheOptions,
): Promise<ConnectedAuthorizationCache> => {
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    throw new TypeError("AUTHORIZATION_INVALID_CACHE_OPTIONS");
  }
  if (!["redis:", "rediss:"].includes(url.protocol) ||
    (url.protocol !== "rediss:" && options.allowInsecureDevelopment !== true) ||
    url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0 ||
    options.password.length < 16 || options.password.length > 4_096 ||
    !Number.isInteger(options.connectTimeoutMilliseconds) || options.connectTimeoutMilliseconds < 100 ||
    options.connectTimeoutMilliseconds > 30_000) throw new TypeError("AUTHORIZATION_INVALID_CACHE_OPTIONS");
  const runtime = await importRuntime("redis") as RedisRuntime;
  const client = runtime.createClient({
    password: options.password,
    socket: { connectTimeout: options.connectTimeoutMilliseconds, reconnectStrategy: false },
    url: options.url,
  });
  try {
    await client.connect();
  } catch {
    try { client.destroy(); } catch { /* Preserve the stable unavailable error. */ }
    throw new TypeError("AUTHORIZATION_CACHE_UNAVAILABLE");
  }
  return Object.freeze({
    cache: createRedisAuthorizationCache({ send: (command) => client.sendCommand(command) }, options.namespace),
    async close() {
      try {
        await client.quit();
      } catch {
        try { client.destroy(); } catch { /* Cache shutdown cannot change authorization truth. */ }
      }
    },
  });
};
