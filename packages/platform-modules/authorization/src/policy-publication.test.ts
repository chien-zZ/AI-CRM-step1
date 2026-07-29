import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

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
  auditOperationIds: {
    authorizationDenied: "60000000-0000-4000-8000-000000000007",
    authorizationFailed: "60000000-0000-4000-8000-000000000008",
    publicationFailed: "60000000-0000-4000-8000-000000000009",
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
    permission: { action: "publish", resource: "platform.authorization.policy" },
    publisher: { publish: vi.fn((input: ProtectedPublishAuthorizationPolicyCommand) => Promise.resolve({ contentDigest: "a".repeat(64), publicationId: input.publicationId, publishedAt: input.publishedAt, replayed: false, version: input.snapshot.version })) },
  } satisfies ProtectedAuthorizationPolicyPublisherOptions;
  return { auditRecords, options, service: createProtectedAuthorizationPolicyPublisher(options) };
}

describe("protected authorization policy publication", () => {
  it("keeps the source contract aligned with stable audit IDs and non-zero Trace", async () => {
    const schema = JSON.parse(await readFile(new URL("../../../../contracts/permissions/protected-policy-publication-command.v1.schema.json", import.meta.url), "utf8")) as {
      properties: { traceId: { pattern: string } };
      required: string[];
    };
    expect(schema.required).toContain("auditOperationIds");
    const tracePattern = new RegExp(schema.properties.traceId.pattern, "u");
    expect(tracePattern.test("0".repeat(32))).toBe(false);
    expect(tracePattern.test(command().traceId)).toBe(true);
  });

  it("authorizes the current workforce context before publishing and records management audit", async () => {
    const { auditRecords, options, service } = fixture();
    await expect(service.publish(command())).resolves.toMatchObject({ replayed: false, version: "synthetic-v1" });
    expect(options.authorizer.requireAllowed).toHaveBeenCalledWith(
      { activeAssignmentIds: [assignmentId], selectedAssignmentId: assignmentId, workforcePersonId },
      { action: "publish", resource: "platform.authorization.policy" },
      { managementOperationId: command().operationId, traceId: command().traceId },
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
    expect(auditRecords[0]?.auditOperationId).toBe(command().operationId);
    expect(auditRecords[0]?.managementOperationId).toBe(command().operationId);
  });

  it("preserves the reviewed first-publication precondition through the protected boundary", async () => {
    const { options, service } = fixture();
    await service.publish({ ...command(), expectedPreviousVersion: null });
    expect(options.publisher.publish).toHaveBeenCalledWith(expect.objectContaining({ expectedPreviousVersion: null }));
  });

  it("records an authorization denial and never reaches policy persistence", async () => {
    const { auditRecords, options, service } = fixture();
    options.authorizer.requireAllowed.mockRejectedValueOnce(new AuthorizationDeniedError(decisionId));
    await expect(service.publish(command())).rejects.toBeInstanceOf(AuthorizationDeniedError);
    expect(options.publisher.publish).not.toHaveBeenCalled();
    expect(auditRecords).toEqual([expect.objectContaining({ authorizationDecisionId: decisionId, result: "denied", stage: "authorization" })]);
    expect(auditRecords[0]?.auditOperationId).toBe(command().auditOperationIds.authorizationDenied);
  });

  it("fails closed before persistence when authorization is unavailable", async () => {
    const { auditRecords, options, service } = fixture();
    options.authorizer.requireAllowed.mockRejectedValueOnce(new Error("raw token and provider details"));
    await expect(service.publish(command())).rejects.toEqual(new AuthorizationUnavailableError());
    expect(options.publisher.publish).not.toHaveBeenCalled();
    expect(auditRecords).toEqual([expect.objectContaining({ result: "failed", stage: "authorization" })]);
    expect(auditRecords[0]?.auditOperationId).toBe(command().auditOperationIds.authorizationFailed);
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
    expect(auditRecords[0]?.auditOperationId).toBe(command().auditOperationIds.publicationFailed);
  });

  it("returns unavailable when success audit cannot be confirmed and safely retries the same publication", async () => {
    const { options, service } = fixture();
    options.audit.record.mockRejectedValueOnce(new Error("audit database unavailable"));
    await expect(service.publish(command())).rejects.toBeInstanceOf(AuthorizationUnavailableError);
    options.publisher.publish.mockResolvedValueOnce({ contentDigest: "a".repeat(64), publicationId: command().publicationId, publishedAt: command().publishedAt, replayed: true, version: "synthetic-v1" });
    await expect(service.publish(command())).resolves.toMatchObject({ replayed: true });
    expect(options.publisher.publish).toHaveBeenCalledTimes(2);
  });

  it("converges after audit commit-then-throw with a new authorization decision", async () => {
    const stored = new Map<string, string>();
    const attempts: AuthorizationPolicyPublicationAuditRecord[] = [];
    let commitThenThrow = true;
    const audit = {
      record(record: AuthorizationPolicyPublicationAuditRecord): Promise<void> {
        attempts.push(record);
        const semantic = JSON.stringify({
          action: record.action, actor: record.actor, managementOperationId: record.managementOperationId,
          policyVersion: record.policyVersion, publicationId: record.publicationId, reason: record.reason,
          result: record.result, stage: record.stage,
        });
        const prior = stored.get(record.auditOperationId);
        if (prior !== undefined && prior !== semantic) return Promise.reject(new Error("audit_operation_conflict"));
        stored.set(record.auditOperationId, semantic);
        if (commitThenThrow) { commitThenThrow = false; return Promise.reject(new Error("commit outcome unavailable")); }
        return Promise.resolve();
      },
    };
    const firstDecisionId = "60000000-0000-4000-8000-000000000010";
    const secondDecisionId = "60000000-0000-4000-8000-000000000011";
    const authorizer = { requireAllowed: vi.fn()
      .mockResolvedValueOnce({ allowed: true, decisionId: firstDecisionId, evaluatedAt: "2026-07-28T04:59:59.000Z", policyVersion: "current-v1", reason: "allowed" })
      .mockResolvedValueOnce({ allowed: true, decisionId: secondDecisionId, evaluatedAt: "2026-07-28T05:00:01.000Z", policyVersion: "current-v1", reason: "allowed" }) };
    const publisher = { publish: vi.fn()
      .mockResolvedValueOnce({ contentDigest: "a".repeat(64), publicationId: command().publicationId, publishedAt: command().publishedAt, replayed: false, version: "synthetic-v1" })
      .mockResolvedValueOnce({ contentDigest: "a".repeat(64), publicationId: command().publicationId, publishedAt: command().publishedAt, replayed: true, version: "synthetic-v1" }) };
    const service = createProtectedAuthorizationPolicyPublisher({ audit, authorizer, permission: { action: "publish", resource: "synthetic.authorization-policy" }, publisher });
    await expect(service.publish(command())).rejects.toBeInstanceOf(AuthorizationUnavailableError);
    await expect(service.publish(command())).resolves.toMatchObject({ replayed: true });
    expect(stored.size).toBe(1);
    expect(attempts.map(({ auditOperationId }) => auditOperationId)).toEqual([command().operationId, command().operationId]);
    expect(attempts.map(({ authorizationDecisionId }) => authorizationDecisionId)).toEqual([firstDecisionId, secondDecisionId]);
  });

  it("uses one compatible success audit fact for concurrent identical commands", async () => {
    const stored = new Map<string, string>();
    const audit = { record: vi.fn((record: AuthorizationPolicyPublicationAuditRecord) => {
      const semantic = JSON.stringify({ actor: record.actor, policyVersion: record.policyVersion, publicationId: record.publicationId, reason: record.reason, result: record.result, stage: record.stage });
      const prior = stored.get(record.auditOperationId);
      if (prior !== undefined && prior !== semantic) return Promise.reject(new Error("audit_operation_conflict"));
      stored.set(record.auditOperationId, semantic);
      return Promise.resolve();
    }) };
    const authorizer = { requireAllowed: vi.fn()
      .mockResolvedValueOnce({ allowed: true, decisionId: "60000000-0000-4000-8000-000000000010", evaluatedAt: "2026-07-28T04:59:59.000Z", policyVersion: "current-v1", reason: "allowed" })
      .mockResolvedValueOnce({ allowed: true, decisionId: "60000000-0000-4000-8000-000000000011", evaluatedAt: "2026-07-28T04:59:59.000Z", policyVersion: "current-v1", reason: "allowed" }) };
    const publisher = { publish: vi.fn(() => Promise.resolve({ contentDigest: "a".repeat(64), publicationId: command().publicationId, publishedAt: command().publishedAt, replayed: false, version: "synthetic-v1" })) };
    const service = createProtectedAuthorizationPolicyPublisher({ audit, authorizer, permission: { action: "publish", resource: "synthetic.authorization-policy" }, publisher });
    const results = await Promise.all([service.publish(command()), service.publish(command())]);
    expect(results).toHaveLength(2);
    expect(stored.size).toBe(1);
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  it("requires an exact permission and rejects incomplete composition", () => {
    const { options } = fixture();
    expect(() => createProtectedAuthorizationPolicyPublisher({ ...options, permission: { ...options.permission, resourceContext: { arbitrary: "value" } } }))
      .toThrowError("authorization_policy_invalid");
    expect(() => createProtectedAuthorizationPolicyPublisher({ ...options, authorizer: undefined } as never))
      .toThrowError("authorization_policy_invalid");
  });

  it("binds descriptor-safe dependency methods at construction", async () => {
    let getterCalls = 0;
    const { options } = fixture();
    for (const [port, method] of [["audit", "record"], ["authorizer", "requireAllowed"], ["publisher", "publish"]] as const) {
      const accessorDependency = {};
      Object.defineProperty(accessorDependency, method, { get: () => { getterCalls += 1; return vi.fn(); } });
      expect(() => createProtectedAuthorizationPolicyPublisher({ ...options, [port]: accessorDependency } as never))
        .toThrowError("authorization_policy_invalid");
    }
    expect(getterCalls).toBe(0);
    const throwingProxy = new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error("proxy trap"); } });
    expect(() => createProtectedAuthorizationPolicyPublisher({ ...options, audit: throwingProxy } as never))
      .toThrowError("authorization_policy_invalid");

    const originalAudit = vi.fn(() => Promise.resolve());
    const originalAuthorize = vi.fn(() => Promise.resolve({ allowed: true, decisionId, evaluatedAt: "2026-07-28T04:59:59.000Z", policyVersion: "current-v1", reason: "allowed" as const }));
    const originalPublish = vi.fn(() => Promise.resolve({ contentDigest: "a".repeat(64), publicationId: command().publicationId, publishedAt: command().publishedAt, replayed: false, version: "synthetic-v1" }));
    const audit = { record: originalAudit };
    const authorizer = { requireAllowed: originalAuthorize };
    const publisher = { publish: originalPublish };
    const service = createProtectedAuthorizationPolicyPublisher({ audit, authorizer, permission: { action: "publish", resource: "synthetic.authorization-policy" }, publisher });
    audit.record = vi.fn(() => Promise.reject(new Error("replacement audit")));
    authorizer.requireAllowed = vi.fn(() => Promise.reject(new Error("replacement authorizer")));
    publisher.publish = vi.fn(() => Promise.reject(new Error("replacement publisher")));
    await expect(service.publish(command())).resolves.toMatchObject({ version: "synthetic-v1" });
    expect(originalAudit).toHaveBeenCalledTimes(1);
    expect(originalAuthorize).toHaveBeenCalledTimes(1);
    expect(originalPublish).toHaveBeenCalledTimes(1);
  });

  it("rejects an all-zero Trace ID and duplicate audit operation IDs before dependencies", async () => {
    const { options, service } = fixture();
    await expect(service.publish({ ...command(), traceId: "0".repeat(32) })).rejects.toMatchObject({ code: "authorization_policy_invalid" });
    await expect(service.publish({ ...command(), auditOperationIds: { ...command().auditOperationIds, publicationFailed: command().operationId } }))
      .rejects.toMatchObject({ code: "authorization_policy_invalid" });
    expect(options.authorizer.requireAllowed).not.toHaveBeenCalled();
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
