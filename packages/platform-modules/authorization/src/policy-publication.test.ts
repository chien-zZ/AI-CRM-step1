import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { AuthorizationDeniedError, AuthorizationPersistenceError, AuthorizationUnavailableError } from "./errors.js";
import { createProtectedAuthorizationPolicyPublisher } from "./policy-publication.js";
import { syntheticPolicySnapshot } from "./testing.js";
import type {
  AuthorizationPolicyPublicationAuditRecord,
  ProtectedAuthorizationPolicyPublisherOptions,
  ProtectedPublishAuthorizationPolicyCommand,
} from "./types.js";

const assignmentId = "60000000-0000-4000-8000-000000000003";
const workforcePersonId = "60000000-0000-4000-8000-000000000002";
const decisionId = "60000000-0000-4000-8000-000000000004";

const command = (): ProtectedPublishAuthorizationPolicyCommand => ({
  actor: {
    actorId: "subject:synthetic",
    actorType: "authenticated_subject",
    subject: { activeAssignmentIds: [assignmentId], selectedAssignmentId: assignmentId, workforcePersonId },
  },
  contractVersion: "authorization-policy.v1",
  operationId: "60000000-0000-4000-8000-000000000005",
  publicationId: "60000000-0000-4000-8000-000000000006",
  publishedAt: "2026-07-28T05:00:00.000Z",
  reason: { code: "reviewed_policy_change" },
  snapshot: syntheticPolicySnapshot(),
  traceId: "1234567890abcdef1234567890abcdef",
});

function fixture() {
  const auditRecords: AuthorizationPolicyPublicationAuditRecord[] = [];
  const options = {
    audit: { record: vi.fn((record: AuthorizationPolicyPublicationAuditRecord) => { auditRecords.push(record); return Promise.resolve(); }) },
    authorizer: { requireAllowed: vi.fn(() => Promise.resolve({ allowed: true, decisionId, evaluatedAt: "2026-07-28T04:59:59.000Z", policyVersion: "current-v1", reason: "allowed" as const })) },
    permission: { action: "publish", resource: "synthetic.authorization-policy" },
    publisher: { publish: vi.fn((input: ProtectedPublishAuthorizationPolicyCommand) => Promise.resolve({ contentDigest: "a".repeat(64), publicationId: input.publicationId, publishedAt: input.publishedAt, replayed: false, version: input.snapshot.version })) },
  } satisfies ProtectedAuthorizationPolicyPublisherOptions;
  return { auditRecords, options, service: createProtectedAuthorizationPolicyPublisher(options) };
}

describe("protected authorization policy publication", () => {
  it("authorizes the current workforce context before publishing and records management audit", async () => {
    const { auditRecords, options, service } = fixture();
    await expect(service.publish(command())).resolves.toMatchObject({ replayed: false, version: "synthetic-v1" });
    expect(options.authorizer.requireAllowed).toHaveBeenCalledWith(
      { activeAssignmentIds: [assignmentId], selectedAssignmentId: assignmentId, workforcePersonId },
      { action: "publish", resource: "synthetic.authorization-policy" },
    );
    expect(options.publisher.publish).toHaveBeenCalledTimes(1);
    expect(auditRecords).toEqual([expect.objectContaining({
      action: "authorization.policy.publish", authorizationDecisionId: decisionId,
      policyVersion: "synthetic-v1", publicationId: command().publicationId,
      result: "succeeded", stage: "publication",
    })]);
    expect(auditRecords[0]?.actor).toEqual({
      actorId: "subject:synthetic", actorType: "authenticated_subject",
      assignmentId, workforcePersonId,
    });
    expect(auditRecords[0]?.actor).not.toHaveProperty("subject");
    expect(auditRecords[0]?.idempotencyKey).toBe(`${command().operationId}:publication:succeeded:${decisionId}`);
  });

  it("records an authorization denial and never reaches policy persistence", async () => {
    const { auditRecords, options, service } = fixture();
    options.authorizer.requireAllowed.mockRejectedValueOnce(new AuthorizationDeniedError(decisionId));
    await expect(service.publish(command())).rejects.toBeInstanceOf(AuthorizationDeniedError);
    expect(options.publisher.publish).not.toHaveBeenCalled();
    expect(auditRecords).toEqual([expect.objectContaining({ authorizationDecisionId: decisionId, result: "denied", stage: "authorization" })]);
  });

  it("fails closed before persistence when authorization is unavailable", async () => {
    const { auditRecords, options, service } = fixture();
    options.authorizer.requireAllowed.mockRejectedValueOnce(new Error("raw token and provider details"));
    await expect(service.publish(command())).rejects.toEqual(new AuthorizationUnavailableError());
    expect(options.publisher.publish).not.toHaveBeenCalled();
    expect(auditRecords).toEqual([expect.objectContaining({ result: "failed", stage: "authorization" })]);
    expect(auditRecords[0]).not.toHaveProperty("authorizationDecisionId");
  });

  it("rejects contradictory Assignment context and accessors before calling dependencies", async () => {
    const { options, service } = fixture();
    const contradictory = command() as unknown as { actor: { subject: unknown } };
    contradictory.actor.subject = { ...command().actor.subject, selectedAssignmentId: randomUUID() };
    await expect(service.publish(contradictory as never)).rejects.toMatchObject({ code: "authorization_policy_invalid" });

    let getterCalls = 0;
    const accessor = command();
    Object.defineProperty(accessor.actor.subject, "workforcePersonId", { enumerable: true, get: () => { getterCalls += 1; return workforcePersonId; } });
    await expect(service.publish(accessor)).rejects.toMatchObject({ code: "authorization_policy_invalid" });
    expect(getterCalls).toBe(0);
    expect(options.authorizer.requireAllowed).not.toHaveBeenCalled();
    expect(options.publisher.publish).not.toHaveBeenCalled();
  });

  it("snapshots the complete policy before awaiting authorization", async () => {
    const { options, service } = fixture();
    let release!: () => void;
    options.authorizer.requireAllowed.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => { resolve({ allowed: true, decisionId, evaluatedAt: "2026-07-28T04:59:59.000Z", policyVersion: "current-v1", reason: "allowed" }); };
    }));
    const input = command();
    const pending = service.publish(input);
    const firstPermission = input.snapshot.permissions[0] as { action: string } | undefined;
    if (!firstPermission) throw new Error("synthetic permission fixture is required");
    firstPermission.action = "changed-after-call";
    release();
    await pending;
    const persisted = options.publisher.publish.mock.calls[0]?.[0];
    expect(persisted?.snapshot.permissions[0]?.action).toBe("execute");
    expect(Object.isFrozen(persisted?.snapshot)).toBe(true);
  });

  it("records publication failure and preserves stable persistence errors", async () => {
    const { auditRecords, options, service } = fixture();
    options.publisher.publish.mockRejectedValueOnce(new AuthorizationPersistenceError("authorization_policy_conflict"));
    await expect(service.publish(command())).rejects.toMatchObject({ code: "authorization_policy_conflict" });
    expect(auditRecords).toEqual([expect.objectContaining({ authorizationDecisionId: decisionId, result: "failed", stage: "publication" })]);
  });

  it("returns unavailable when success audit cannot be confirmed and safely retries the same publication", async () => {
    const { options, service } = fixture();
    options.audit.record.mockRejectedValueOnce(new Error("audit database unavailable"));
    await expect(service.publish(command())).rejects.toBeInstanceOf(AuthorizationUnavailableError);
    options.publisher.publish.mockResolvedValueOnce({ contentDigest: "a".repeat(64), publicationId: command().publicationId, publishedAt: command().publishedAt, replayed: true, version: "synthetic-v1" });
    await expect(service.publish(command())).resolves.toMatchObject({ replayed: true });
    expect(options.publisher.publish).toHaveBeenCalledTimes(2);
  });

  it("requires an exact permission and rejects incomplete composition", () => {
    const { options } = fixture();
    expect(() => createProtectedAuthorizationPolicyPublisher({ ...options, permission: { ...options.permission, resourceContext: { arbitrary: "value" } } }))
      .toThrowError("authorization_policy_invalid");
    expect(() => createProtectedAuthorizationPolicyPublisher({ ...options, authorizer: undefined } as never))
      .toThrowError("authorization_policy_invalid");
  });

  it("does not execute accessors returned by the authorization dependency", async () => {
    const { options, service } = fixture();
    let getterCalls = 0;
    const decision = { decisionId, evaluatedAt: "2026-07-28T04:59:59.000Z", policyVersion: "current-v1", reason: "allowed" };
    Object.defineProperty(decision, "allowed", { enumerable: true, get: () => { getterCalls += 1; return true; } });
    options.authorizer.requireAllowed.mockResolvedValueOnce(decision as never);
    await expect(service.publish(command())).rejects.toBeInstanceOf(AuthorizationUnavailableError);
    expect(getterCalls).toBe(0);
    expect(options.publisher.publish).not.toHaveBeenCalled();
  });

  it("treats malformed denial and allow decisions as authorization unavailability", async () => {
    const malformedDenial = fixture();
    malformedDenial.options.authorizer.requireAllowed.mockRejectedValueOnce(new AuthorizationDeniedError("not-a-decision-id"));
    await expect(malformedDenial.service.publish(command())).rejects.toBeInstanceOf(AuthorizationUnavailableError);
    expect(malformedDenial.options.publisher.publish).not.toHaveBeenCalled();
    expect(malformedDenial.auditRecords).toEqual([expect.objectContaining({ result: "failed", stage: "authorization" })]);

    const malformedAllow = fixture();
    malformedAllow.options.authorizer.requireAllowed.mockResolvedValueOnce({
      allowed: true, decisionId, evaluatedAt: "invalid", policyVersion: "current-v1", reason: "allowed",
    });
    await expect(malformedAllow.service.publish(command())).rejects.toBeInstanceOf(AuthorizationUnavailableError);
    expect(malformedAllow.options.publisher.publish).not.toHaveBeenCalled();
  });
});
