import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AuditError, createAuditService, createMemoryAuditStore, type AuditAuthorizer, type RecordAuditCommand } from "./index.js";

const actor = { actorId: "subject:synthetic", actorType: "authenticated_subject" as const, assignmentId: "11111111-1111-4111-8111-111111111111", workforcePersonId: "22222222-2222-4222-8222-222222222222" };
const operationId = "33333333-3333-4333-8333-333333333333";
const traceId = "1234567890abcdef1234567890abcdef";
const allowed = { authorize: vi.fn<AuditAuthorizer["authorize"]>(() => Promise.resolve({ allowed: true, decisionId: "44444444-4444-4444-8444-444444444444" })) } satisfies AuditAuthorizer;
const options = { clock: () => new Date("2026-07-26T00:00:00.000Z"), fieldPolicies: { "synthetic.changed": [{ classification: "non_sensitive" as const, field: "enabled" }, { classification: "sensitive" as const, field: "protected_value" }] }, id: () => "55555555-5555-4555-8555-555555555555" };
const command: RecordAuditCommand = { action: "synthetic.changed", actor, changes: [{ after: true, before: false, classification: "non_sensitive", field: "enabled" }, { changed: true, classification: "sensitive", field: "protected_value" }], reason: { code: "synthetic_test" }, resource: { resourceId: "synthetic:1", resourceType: "synthetic_resource" }, result: "succeeded", trace: { operationId, traceId } };

describe("audit service", () => {
  it("appends explicit facts and replays an identical operation without mutation", async () => {
    const service = createAuditService(createMemoryAuditStore(), allowed, options);
    await expect(service.record(command)).resolves.toEqual({ auditId: "55555555-5555-4555-8555-555555555555", replayed: false });
    await expect(service.record(command)).resolves.toEqual({ auditId: "55555555-5555-4555-8555-555555555555", replayed: true });
    await expect(service.record({ ...command, result: "failed" })).rejects.toMatchObject({ code: "audit_operation_conflict" });
  });

  it("rejects undeclared or value-bearing sensitive differences", async () => {
    const service = createAuditService(createMemoryAuditStore(), allowed, options);
    await expect(service.record({ ...command, changes: [{ after: "secret", classification: "non_sensitive", field: "protected_value" }] })).rejects.toMatchObject({ code: "audit_invalid_input" });
    await expect(service.record({ ...command, changes: [{ after: true, classification: "non_sensitive", field: "unknown" }] })).rejects.toMatchObject({ code: "audit_invalid_input" });
    await expect(service.record({ ...command, changes: [{ before: "secret", changed: true, classification: "sensitive", field: "protected_value", token: "secret" }] } as never)).rejects.toMatchObject({ code: "audit_invalid_input" });
  });

  it("rejects extra keys and runtime-invalid actors, results, scalars, and decisions", async () => {
    const service = createAuditService(createMemoryAuditStore(), allowed, options);
    await expect(service.record({ ...command, actor: { ...actor, actorType: "admin" } } as never)).rejects.toMatchObject({ code: "audit_invalid_input" });
    await expect(service.record({ ...command, result: "complete" } as never)).rejects.toMatchObject({ code: "audit_invalid_input" });
    await expect(service.record({ ...command, token: "secret" } as never)).rejects.toMatchObject({ code: "audit_invalid_input" });
    await expect(service.record({ ...command, changes: [{ after: { nested: true }, classification: "non_sensitive", field: "enabled" }] } as never)).rejects.toMatchObject({ code: "audit_invalid_input" });
    const invalidDecision = createAuditService(createMemoryAuditStore(), { authorize: () => Promise.resolve({ allowed: "yes", decisionId: randomUUID() } as never) }, { ...options, id: randomUUID });
    await expect(invalidDecision.readSensitive({ actor, operationId: randomUUID(), reason: "synthetic investigation", recordId: randomUUID(), traceId })).rejects.toMatchObject({ code: "audit_authorization_unavailable", retryable: true });
  });

  it("replays semantically identical records with reordered object keys and changes", async () => {
    const service = createAuditService(createMemoryAuditStore(), allowed, options);
    const reordered = {
      trace: { traceId, operationId },
      result: command.result,
      resource: { resourceType: command.resource.resourceType, resourceId: command.resource.resourceId },
      reason: { code: command.reason.code },
      changes: [{ field: "protected_value", classification: "sensitive" as const, changed: true as const }, { field: "enabled", classification: "non_sensitive" as const, before: false, after: true }],
      actor: { workforcePersonId: actor.workforcePersonId, assignmentId: actor.assignmentId, actorType: actor.actorType, actorId: actor.actorId },
      action: command.action,
    } satisfies RecordAuditCommand;
    await expect(service.record(command)).resolves.toMatchObject({ replayed: false });
    await expect(service.record(reordered)).resolves.toEqual({ auditId: "55555555-5555-4555-8555-555555555555", replayed: true });
  });

  it("fails closed and records denied sensitive access", async () => {
    const store = createMemoryAuditStore();
    const denied = { authorize: vi.fn(() => Promise.resolve({ allowed: false, decisionId: "66666666-6666-4666-8666-666666666666" })) };
    const service = createAuditService(store, denied, { ...options, id: randomUUID });
    await expect(service.readSensitive({ actor, operationId: randomUUID(), reason: "synthetic investigation", recordId: randomUUID(), traceId })).rejects.toMatchObject({ code: "audit_access_denied" });
    expect(denied.authorize).toHaveBeenCalledOnce();
  });

  it("reauthorizes sensitive reads and records success before returning the fact", async () => {
    const store = createMemoryAuditStore();
    const service = createAuditService(store, allowed, { ...options, id: randomUUID });
    const source = await service.record({ ...command, trace: { ...command.trace, operationId: randomUUID() } });
    const result = await service.readSensitive({ actor, operationId: randomUUID(), reason: "synthetic investigation", recordId: source.auditId, traceId });
    expect(result.auditId).toBe(source.auditId);
    expect(allowed.authorize).toHaveBeenCalledWith(expect.objectContaining({ action: "audit:read_sensitive", resource: { resourceId: source.auditId, resourceType: "audit_record" } }));
  });

  it("does not infer facts when clock or persistence fails", async () => {
    const clockFailure = createAuditService(createMemoryAuditStore(), allowed, { ...options, clock: () => { throw new Error("clock"); } });
    await expect(clockFailure.record(command)).rejects.toBeInstanceOf(AuditError);
    const unavailable = createAuditService({ append: () => Promise.reject(new Error("down")), findById: () => Promise.resolve(undefined) }, allowed, options);
    await expect(unavailable.record(command)).rejects.toMatchObject({ code: "audit_store_unavailable", retryable: true });
    const authorizationUnavailable = createAuditService(createMemoryAuditStore(), { authorize: () => Promise.reject(new Error("down")) }, { ...options, id: randomUUID });
    await expect(authorizationUnavailable.readSensitive({ actor, operationId: randomUUID(), reason: "synthetic investigation", recordId: randomUUID(), traceId })).rejects.toMatchObject({ code: "audit_authorization_unavailable", retryable: true });
  });
});
