import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { OrganizationError } from "./errors.js";
import { createMemoryOrganizationStore } from "./memory-store.js";
import { OrganizationService } from "./service.js";
import type { OrganizationCommandAuthorizationRequest } from "./types.js";

const at = "2026-07-26T00:00:00.000Z";
const later = "2026-08-01T00:00:00.000Z";
const subject = { issuer: "https://identity.example.test/realms/ai-crm", subject: "synthetic-subject" };

const ids = {
  assignmentA: "00000000-0000-4000-8000-000000000007",
  assignmentB: "00000000-0000-4000-8000-000000000009",
  association: "00000000-0000-4000-8000-000000000003",
  employment: "00000000-0000-4000-8000-000000000002",
  person: "00000000-0000-4000-8000-000000000001",
  placement: "00000000-0000-4000-8000-000000000005",
  positionA: "00000000-0000-4000-8000-000000000006",
  positionB: "00000000-0000-4000-8000-000000000008",
  unit: "00000000-0000-4000-8000-000000000004",
};

const metadata = (operationId = randomUUID()) => ({
  actor: { actorId: "synthetic-admin", actorType: "system" as const },
  operationId,
  reason: "synthetic IAM-02 acceptance fixture",
  traceId: "trace-iam-02",
});
const allow = { authorize: () => Promise.resolve() };

describe("OrganizationService", () => {
  let service: OrganizationService;

  beforeEach(() => { service = new OrganizationService(createMemoryOrganizationStore(), allow); });

  it("fails closed when an authenticated subject has no workforce association", async () => {
    await expect(service.resolveWorkforceContext(subject, at)).rejects.toMatchObject({ code: "subject_not_associated" });
  });

  it("returns concurrent assignments without selecting an implicit primary context", async () => {
    await seed(service, true);
    const context = await service.resolveWorkforceContext(subject, at);
    expect(context.workforcePersonId).toBe(ids.person);
    expect(context.employmentIds).toEqual([ids.employment]);
    expect(context.assignments.map(({ assignmentId }) => assignmentId)).toEqual([ids.assignmentA, ids.assignmentB]);

    const selected = await service.resolveWorkforceContext(subject, at, ids.assignmentB);
    expect(selected.assignments.map(({ assignmentId }) => assignmentId)).toEqual([ids.assignmentB]);
    await expect(service.resolveWorkforceContext(subject, at, randomUUID())).rejects.toMatchObject({ code: "assignment_not_active" });
  });

  it("closes one assignment without affecting another active assignment", async () => {
    await seed(service, true);
    await service.closeAssignment({ ...metadata(), effectiveTo: later, factId: ids.assignmentA });
    const context = await service.resolveWorkforceContext(subject, later);
    expect(context.assignments.map(({ assignmentId }) => assignmentId)).toEqual([ids.assignmentB]);
  });

  it("rejects access at the half-open Employment boundary while preserving historical resolution", async () => {
    await seed(service);
    await service.closeEmployment({ ...metadata(), effectiveTo: later, factId: ids.employment });
    await expect(service.resolveWorkforceContext(subject, later)).rejects.toMatchObject({ code: "employment_not_active" });
    await expect(service.resolveWorkforceContext(subject, at)).resolves.toMatchObject({ workforcePersonId: ids.person });
  });

  it("enforces one effective subject per person and one person per subject", async () => {
    await seed(service);
    const anotherPerson = randomUUID();
    await service.createWorkforcePerson({ ...metadata(), recordedAt: at, workforcePersonId: anotherPerson });
    await expect(service.createSubjectAssociation({
      ...metadata(), ...subject, associationId: randomUUID(), effectiveFrom: at, workforcePersonId: anotherPerson,
    })).rejects.toMatchObject({ code: "conflicting_subject_association" });
    await expect(service.createSubjectAssociation({
      ...metadata(), associationId: randomUUID(), effectiveFrom: at,
      issuer: subject.issuer, subject: "another-subject", workforcePersonId: ids.person,
    })).rejects.toMatchObject({ code: "conflicting_subject_association" });
  });

  it("replays the same operation and rejects reuse with different content", async () => {
    const operationId = randomUUID();
    const command = { ...metadata(operationId), recordedAt: at, workforcePersonId: ids.person };
    await service.createWorkforcePerson(command);
    await expect(service.createWorkforcePerson(command)).resolves.toBeUndefined();
    const conflict = service.createWorkforcePerson({ ...command, workforcePersonId: randomUUID() });
    await expect(conflict).rejects.toBeInstanceOf(OrganizationError);
    await expect(service.createWorkforcePerson({
      ...command, actor: { actorId: "different-actor", actorType: "system" },
    })).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("rejects invalid intervals and cross-person assignment references", async () => {
    await service.createWorkforcePerson({ ...metadata(), recordedAt: at, workforcePersonId: ids.person });
    await expect(service.createEmployment({
      ...metadata(), effectiveFrom: later, effectiveTo: at, employmentId: ids.employment, workforcePersonId: ids.person,
    })).rejects.toMatchObject({ code: "effective_interval_invalid" });
    await expect(service.createSubjectAssociation({
      ...metadata(), associationId: ids.association, effectiveFrom: at,
      issuer: "ftp://localhost/realm", subject: "synthetic", workforcePersonId: ids.person,
    })).rejects.toMatchObject({ code: "entity_conflict" });

    service = new OrganizationService(createMemoryOrganizationStore(), allow);
    await seed(service);
    await expect(service.createAssignment({
      ...metadata(), assignmentId: randomUUID(), effectiveFrom: at, employmentId: ids.employment,
      organizationUnitId: ids.unit, positionId: ids.positionA, workforcePersonId: randomUUID(),
    })).rejects.toMatchObject({ code: "entity_not_found" });
  });

  it("preserves effective placement history and rejects a reparenting cycle", async () => {
    const root = randomUUID();
    const rootPlacement = randomUUID();
    const child = randomUUID();
    await service.createOrganizationUnit({
      ...metadata(), effectiveFrom: at, organizationUnitId: root, placementId: rootPlacement,
    });
    await service.createOrganizationUnit({
      ...metadata(), effectiveFrom: at, organizationUnitId: child,
      parentOrganizationUnitId: root, placementId: randomUUID(),
    });
    await service.closeOrganizationUnitPlacement({ ...metadata(), effectiveTo: later, factId: rootPlacement });
    await expect(service.createOrganizationUnitPlacement({
      ...metadata(), effectiveFrom: later, organizationUnitId: root,
      parentOrganizationUnitId: child, placementId: randomUUID(),
    })).rejects.toMatchObject({ code: "organization_hierarchy_cycle" });
  });

  it("fails before persistence when server-side command authorization denies", async () => {
    const denied = new OrganizationService(createMemoryOrganizationStore(), {
      authorize: () => Promise.reject(new Error("synthetic authorization denial")),
    });
    await expect(denied.createWorkforcePerson({ ...metadata(), recordedAt: at, workforcePersonId: ids.person }))
      .rejects.toThrow("synthetic authorization denial");
    await expect(denied.resolveWorkforceContext(subject, at)).rejects.toMatchObject({ code: "subject_not_associated" });
    await expect(denied.createPosition({
      ...metadata(), effectiveFrom: at, organizationUnitId: ids.unit, positionId: ids.positionA,
    })).rejects.toThrow("synthetic authorization denial");
  });

  it("provides the target entity to the server-side authorizer", async () => {
    let request: OrganizationCommandAuthorizationRequest | undefined;
    const authorized = new OrganizationService(createMemoryOrganizationStore(), {
      authorize: (value) => { request = value; return Promise.resolve(); },
    });
    await authorized.createWorkforcePerson({ ...metadata(), recordedAt: at, workforcePersonId: ids.person });
    expect(request).toMatchObject({ entityId: ids.person, entityType: "workforce_person" });
  });

  it("rejects child facts whose interval extends beyond the owning fact", async () => {
    await service.createWorkforcePerson({ ...metadata(), recordedAt: at, workforcePersonId: ids.person });
    await service.createEmployment({
      ...metadata(), effectiveFrom: at, effectiveTo: later,
      employmentId: ids.employment, workforcePersonId: ids.person,
    });
    await service.createOrganizationUnit({
      ...metadata(), effectiveFrom: at, effectiveTo: later,
      organizationUnitId: ids.unit, placementId: ids.placement,
    });
    await expect(service.createPosition({
      ...metadata(), effectiveFrom: at, organizationUnitId: ids.unit, positionId: ids.positionA,
    })).rejects.toMatchObject({ code: "effective_interval_invalid" });
    await service.createPosition({
      ...metadata(), effectiveFrom: at, effectiveTo: later,
      organizationUnitId: ids.unit, positionId: ids.positionA,
    });
    await expect(service.createAssignment({
      ...metadata(), assignmentId: ids.assignmentA, effectiveFrom: at,
      employmentId: ids.employment, organizationUnitId: ids.unit,
      positionId: ids.positionA, workforcePersonId: ids.person,
    })).rejects.toMatchObject({ code: "effective_interval_invalid" });
  });

  it("validates only the explicitly selected assignment context", async () => {
    const store = createMemoryOrganizationStore();
    service = new OrganizationService(store, allow);
    await seed(service);
    const corruptAssignmentId = randomUUID();
    await store.commit({
      actor: metadata().actor,
      auditAction: "synthetic_corrupt_assignment",
      eventType: "synthetic.corrupt.v1",
      fingerprint: "0".repeat(64),
      operationId: randomUUID(),
      reason: "synthetic corruption fixture",
      traceId: "trace-corrupt",
      write: {
        assignment: {
          assignmentId: corruptAssignmentId,
          effectiveFrom: at,
          employmentId: ids.employment,
          organizationUnitId: ids.unit,
          positionId: randomUUID(),
          workforcePersonId: ids.person,
        },
        kind: "create_assignment",
      },
    });
    await expect(service.resolveWorkforceContext(subject, at, ids.assignmentA)).resolves.toMatchObject({
      assignments: [{ assignmentId: ids.assignmentA }],
    });
    await expect(service.resolveWorkforceContext(subject, at)).rejects.toMatchObject({ code: "organization_path_invalid" });
  });

  it("keeps compound organization-unit creation atomic when its placement conflicts", async () => {
    const store = createMemoryOrganizationStore();
    const firstUnitId = randomUUID();
    const conflictingPlacementId = randomUUID();
    const rejectedUnitId = randomUUID();
    const command = (organizationUnitId: string, operationId: string) => ({
      actor: metadata().actor,
      auditAction: "organization_unit_created",
      eventType: "organization.organization-unit.created.v1",
      fingerprint: operationId.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
      operationId,
      reason: "memory-store atomicity fixture",
      traceId: `trace-${operationId}`,
      write: {
        kind: "create_organization_unit" as const,
        placement: { effectiveFrom: at, organizationUnitId, placementId: conflictingPlacementId },
        unit: { effectiveFrom: at, organizationUnitId },
      },
    });
    await store.commit(command(firstUnitId, randomUUID()));
    await expect(Promise.resolve().then(()=>store.commit(command(rejectedUnitId, randomUUID())))).rejects.toMatchObject({ code: "entity_conflict" });
    await expect(store.findOrganizationUnit(rejectedUnitId)).resolves.toBeUndefined();
  });

  it("rejects a hierarchy cycle that would begin at a scheduled future placement", async () => {
    const first = randomUUID();
    const firstRootPlacement = randomUUID();
    const second = randomUUID();
    const secondRootPlacement = randomUUID();
    const middle = "2026-08-01T00:00:00.000Z";
    const future = "2026-09-01T00:00:00.000Z";
    await service.createOrganizationUnit({ ...metadata(), effectiveFrom: at, organizationUnitId: first, placementId: firstRootPlacement });
    await service.createOrganizationUnit({ ...metadata(), effectiveFrom: at, organizationUnitId: second, placementId: secondRootPlacement });
    await service.closeOrganizationUnitPlacement({ ...metadata(), effectiveTo: future, factId: secondRootPlacement });
    await service.createOrganizationUnitPlacement({
      ...metadata(), effectiveFrom: future, organizationUnitId: second,
      parentOrganizationUnitId: first, placementId: randomUUID(),
    });
    await service.closeOrganizationUnitPlacement({ ...metadata(), effectiveTo: middle, factId: firstRootPlacement });
    await expect(service.createOrganizationUnitPlacement({
      ...metadata(), effectiveFrom: middle, organizationUnitId: first,
      parentOrganizationUnitId: second, placementId: randomUUID(),
    })).rejects.toMatchObject({ code: "organization_hierarchy_cycle" });
  });
});

async function seed(service: OrganizationService, secondAssignment = false): Promise<void> {
  await service.createWorkforcePerson({ ...metadata(), recordedAt: at, workforcePersonId: ids.person });
  await service.createEmployment({ ...metadata(), effectiveFrom: at, employmentId: ids.employment, workforcePersonId: ids.person });
  await service.createOrganizationUnit({
    ...metadata(), effectiveFrom: at, organizationUnitId: ids.unit, placementId: ids.placement,
  });
  await service.createPosition({ ...metadata(), effectiveFrom: at, organizationUnitId: ids.unit, positionId: ids.positionA });
  await service.createAssignment({
    ...metadata(), assignmentId: ids.assignmentA, effectiveFrom: at, employmentId: ids.employment,
    organizationUnitId: ids.unit, positionId: ids.positionA, workforcePersonId: ids.person,
  });
  if (secondAssignment) {
    await service.createPosition({ ...metadata(), effectiveFrom: at, organizationUnitId: ids.unit, positionId: ids.positionB });
    await service.createAssignment({
      ...metadata(), assignmentId: ids.assignmentB, effectiveFrom: at, employmentId: ids.employment,
      organizationUnitId: ids.unit, positionId: ids.positionB, workforcePersonId: ids.person,
    });
  }
  await service.createSubjectAssociation({
    ...metadata(), ...subject, associationId: ids.association, effectiveFrom: at, workforcePersonId: ids.person,
  });
}
