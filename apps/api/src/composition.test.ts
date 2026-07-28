import type { AuthenticatedPrincipal } from "@ai-crm/platform-auth-context";
import type { AuthorizationDecision } from "@ai-crm/platform-authorization";
import type { WorkforceContext } from "@ai-crm/platform-organization";
import { describe, expect, it, vi } from "vitest";

import { createApiPlatformComposition, type ApiPlatformBindings } from "./composition.js";

const principal: AuthenticatedPrincipal = {
  authenticationSubject: { issuer: "https://identity.invalid/realms/synthetic", subject: "synthetic-subject" },
  clientId: "pc-web",
  expiresAt: "2026-07-27T01:00:00.000Z",
  issuedAt: "2026-07-27T00:00:00.000Z",
};
const workforce: WorkforceContext = {
  assignments: [{ assignmentId: "assignment-a", employmentId: "employment-a", organizationUnitId: "unit-a", positionId: "position-a" }],
  employmentIds: ["employment-a"],
  resolvedAt: "2026-07-27T00:00:00.000Z",
  subject: principal.authenticationSubject,
  workforcePersonId: "person-a",
};
const decision: AuthorizationDecision = {
  allowed: true,
  decisionId: "decision-a",
  evaluatedAt: "2026-07-27T00:00:00.000Z",
  policyVersion: "synthetic-v1",
  reason: "allowed",
};

function bindings(overrides: Partial<ApiPlatformBindings> = {}): ApiPlatformBindings {
  return {
    audit: { readSensitive: vi.fn(), record: vi.fn() },
    authentication: { beginLogin: vi.fn(), completeLogin: vi.fn(), currentSession: vi.fn(), logout: vi.fn(), refresh: vi.fn() },
    authenticationCallbackUrl: (requestPathAndQuery) => `https://api.invalid${requestPathAndQuery}`,
    browserSecurity: { allowedOrigins: ["https://workbench.invalid"] },
    authorization: { requireAllowed: vi.fn().mockResolvedValue(decision) } as unknown as ApiPlatformBindings["authorization"],
    authorizationTrace: { run: async (_traceId, work) => work() },
    databaseCompatibility: { assertCompatible: vi.fn() },
    organization: { resolveWorkforceContext: vi.fn().mockResolvedValue(workforce) } as unknown as ApiPlatformBindings["organization"],
    queries: {
      applicationRegistry: { loadRegistry: vi.fn(), resolveDeepLink: vi.fn() },
      fileCenter: { authorizeDownload: vi.fn(), completeUpload: vi.fn(), createUploadSession: vi.fn() },
      forms: { getRelease: vi.fn(), validateSubmission: vi.fn() },
      notifications: { get: vi.fn(), list: vi.fn(), unreadCount: vi.fn() },
      tasks: { get: vi.fn(), list: vi.fn() },
    },
    readiness: () => [],
    sessions: { resolvePrincipal: vi.fn().mockResolvedValue(principal), sessionForMutation: vi.fn() },
    ...overrides,
  };
}

describe("API platform composition", () => {
  it("resolves principal, workforce, and authorization in fail-closed order", async () => {
    const run = vi.fn(async (_traceId: string, work: () => Promise<unknown>) => work());
    const configured = bindings({ authorizationTrace: { run } as unknown as ApiPlatformBindings["authorizationTrace"] });
    const composition = createApiPlatformComposition(configured);
    await expect(composition.authorize({
      at: "2026-07-27T00:00:00.000Z",
      credential: "synthetic-credential",
      permission: { action: "read", resource: "synthetic:resource" },
      selectedAssignmentId: "assignment-a",
      traceId: "1234567890abcdef1234567890abcdef",
    })).resolves.toEqual({ decision, principal, workforce });
    expect(run).toHaveBeenCalledWith("1234567890abcdef1234567890abcdef", expect.any(Function));
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(configured.organization.resolveWorkforceContext).toHaveBeenCalledWith(
      principal.authenticationSubject,
      "2026-07-27T00:00:00.000Z",
      "assignment-a",
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(configured.authorization.requireAllowed).toHaveBeenCalledWith({
      activeAssignmentIds: ["assignment-a"],
      selectedAssignmentId: "assignment-a",
      workforcePersonId: "person-a",
    }, { action: "read", resource: "synthetic:resource" });
  });

  it("never reaches authorization when workforce resolution fails", async () => {
    const organizationFailure = new Error("subject_not_associated");
    const configured = bindings({
      organization: { resolveWorkforceContext: vi.fn().mockRejectedValue(organizationFailure) } as unknown as ApiPlatformBindings["organization"],
    });
    const composition = createApiPlatformComposition(configured);
    await expect(composition.authorize({
      at: "2026-07-27T00:00:00.000Z",
      credential: "synthetic-credential",
      permission: { action: "read", resource: "synthetic:resource" },
    })).rejects.toBe(organizationFailure);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(configured.authorization.requireAllowed).not.toHaveBeenCalled();
  });

  it("requires every production composition binding", () => {
    const configured = bindings();
    const incomplete = { ...configured, audit: undefined } as unknown as ApiPlatformBindings;
    expect(() => createApiPlatformComposition(incomplete)).toThrow("api_binding_missing_audit");
  });

  it("checks migration compatibility without running migrations", async () => {
    const configured = bindings();
    const composition = createApiPlatformComposition(configured);
    await composition.lifecycle.onStart?.(new AbortController().signal);
    expect(configured.databaseCompatibility.assertCompatible).toHaveBeenCalledOnce();
  });
});
