import { describe, expect, it, vi } from "vitest";

import type { AuthorizationDecision, AuthorizationService } from "@ai-crm/platform-authorization";

import { createPlatformAuthorizationClient } from "./authorization.js";

describe("platform authorization client", () => {
  it("delegates only the stable authorization capability surface", async () => {
    const decision: AuthorizationDecision = {
      allowed: false,
      decisionId: "60000000-0000-4000-8000-000000000001",
      evaluatedAt: "2026-02-01T00:00:00.000Z",
      policyVersion: "synthetic-v1",
      reason: "no_applicable_grant",
    };
    const service = {
      assertAllowed: vi.fn(),
      batchCheck: vi.fn(async () => [decision]),
      check: vi.fn(async () => decision),
      resolveDataScope: vi.fn(async () => ({ decision })),
    } satisfies Pick<AuthorizationService, "assertAllowed" | "batchCheck" | "check" | "resolveDataScope">;
    const client = createPlatformAuthorizationClient(service);
    const subject = { activeAssignmentIds: [], personId: "60000000-0000-4000-8000-000000000002" };
    const request = { action: "read", resource: "synthetic.record" };

    await expect(client.check(subject, request)).resolves.toBe(decision);
    await expect(client.batchCheck(subject, [request])).resolves.toEqual([decision]);
    await expect(client.resolveDataScope(subject, request)).resolves.toEqual({ decision });
    client.assertAllowed(decision);
    expect(Object.keys(client).sort()).toEqual(["assertAllowed", "batchCheck", "check", "resolveDataScope"]);
  });
});
