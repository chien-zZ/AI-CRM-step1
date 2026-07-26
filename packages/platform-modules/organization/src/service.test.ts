import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { OrganizationError } from "./errors.js";
import { createMemoryOrganizationStore } from "./memory-store.js";
import { OrganizationService } from "./service.js";

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
