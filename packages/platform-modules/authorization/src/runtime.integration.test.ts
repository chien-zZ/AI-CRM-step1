import { existsSync, readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { createClient } from "redis";
import { describe, expect, it } from "vitest";

import { connectRedisAuthorizationCache } from "./redis-cache.js";

const secretFile = process.env["AI_CRM_AUTHORIZATION_REDIS_PASSWORD_FILE"] ??
  resolve(process.cwd(), "../../../deploy/compose/.runtime/local/secrets/redis-password");
const runIntegration = existsSync(secretFile) ? describe : describe.skip;

runIntegration("Redis authorization cache integration", () => {
  it("round-trips expiring evaluations and invalidates a policy version without identity-bearing keys", async () => {
    const password = readFileSync(secretFile, "utf8").trim();
    const suffix = randomBytes(8).toString("hex");
    const namespace = `ai-crm:authorization:test:${suffix}`;
    const policyVersion = "synthetic-integration-v1";
    const workforcePersonId = "70000000-0000-4000-8000-000000000001";
    const assignmentId = "70000000-0000-4000-8000-000000000002";
    const cacheKey = createHash("sha256").update(JSON.stringify({ assignmentId, workforcePersonId })).digest("hex");
    const url = "redis://127.0.0.1:6379";
    const connected = await connectRedisAuthorizationCache({
      allowInsecureDevelopment: true,
      connectTimeoutMilliseconds: 2_000,
      namespace,
      password,
      url,
    });
    const inspector = createClient({
      password,
      socket: { connectTimeout: 2_000, reconnectStrategy: false },
      url,
    });

    try {
      await inspector.connect();
      const evaluation = { allowed: true, policyVersion, reason: "allowed" as const };
      await connected.cache.set(cacheKey, evaluation, 30, policyVersion);
      await expect(connected.cache.get(cacheKey)).resolves.toEqual(evaluation);

      const keys = await inspector.keys(`${namespace}:*`);
      expect(keys).toHaveLength(2);
      expect(keys.every((key) => !key.includes(workforcePersonId) && !key.includes(assignmentId))).toBe(true);
      const decisionKey = keys.find((key) => key.includes(":decision:"));
      expect(decisionKey).toBeDefined();
      await expect(inspector.ttl(decisionKey ?? "missing")).resolves.toBeGreaterThan(0);

      await connected.cache.invalidatePolicyVersion(policyVersion);
      await expect(connected.cache.get(cacheKey)).resolves.toBeUndefined();
      await expect(inspector.keys(`${namespace}:*`)).resolves.toEqual([]);
    } finally {
      const remaining = inspector.isReady ? await inspector.keys(`${namespace}:*`) : [];
      if (remaining.length > 0) await inspector.del(remaining);
      if (inspector.isOpen) await inspector.quit();
      await connected.close();
    }
  });
});
