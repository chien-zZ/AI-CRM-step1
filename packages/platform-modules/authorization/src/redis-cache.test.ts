import { describe, expect, it } from "vitest";

import { createRedisAuthorizationCache } from "./redis-cache.js";

class FakeRedis {
  public readonly commands: readonly string[][] = [];
  readonly #sets = new Map<string, Set<string>>();
  readonly #strings = new Map<string, string>();

  public send(command: readonly string[]): Promise<unknown> {
    (this.commands as string[][]).push([...command]);
    const [operation, key, ...args] = command;
    if (operation === "GET") return Promise.resolve(this.#strings.get(key ?? "") ?? null);
    if (operation === "SET") { this.#strings.set(key ?? "", args[0] ?? ""); return Promise.resolve("OK"); }
    if (operation === "SADD") {
      const values = this.#sets.get(key ?? "") ?? new Set<string>();
      for (const value of args) values.add(value);
      this.#sets.set(key ?? "", values);
      return Promise.resolve(args.length);
    }
    if (operation === "SMEMBERS") return Promise.resolve([...(this.#sets.get(key ?? "") ?? [])]);
    if (operation === "DEL") {
      for (const target of [key, ...args]) { if (target !== undefined) { this.#sets.delete(target); this.#strings.delete(target); } }
      return Promise.resolve(1);
    }
    if (operation === "EXPIRE") return Promise.resolve(1);
    return Promise.reject(new Error("unsupported synthetic command"));
  }
}

describe("Redis authorization cache", () => {
  it("stores digest-only keys with TTL and removes a policy version", async () => {
    const redis = new FakeRedis();
    const cache = createRedisAuthorizationCache(redis, "ai-crm:authorization");
    const digest = "a".repeat(64);
    await cache.set(digest, {
      allowed: false, policyVersion: "synthetic-v1", reason: "scope_mismatch",
    }, 30, "synthetic-v1");
    await expect(cache.get(digest)).resolves.toEqual({
      allowed: false, policyVersion: "synthetic-v1", reason: "scope_mismatch",
    });
    await cache.invalidatePolicyVersion("synthetic-v1");
    const serialized = JSON.stringify(redis.commands);
    expect(serialized).not.toContain("person");
    expect(serialized).not.toContain("assignment");
    expect(redis.commands.some(([operation]) => operation === "EXPIRE")).toBe(true);
    await expect(cache.get(digest)).resolves.toBeUndefined();
  });

  it("treats malformed or contradictory cache values as a miss", async () => {
    const redis = new FakeRedis();
    const cache = createRedisAuthorizationCache(redis, "ai-crm:authorization");
    const digest = "b".repeat(64);
    await redis.send(["SET", `ai-crm:authorization:decision:${digest}`, JSON.stringify({
      allowed: true, policyVersion: "synthetic-v1", reason: "scope_mismatch",
    })]);
    await expect(cache.get(digest)).resolves.toBeUndefined();
  });
});
