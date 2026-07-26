import type {
  ActorReference,
  Assignment,
  AuthenticationSubject,
  Employment,
  OrganizationUnit,
  OrganizationUnitPlacement,
  Position,
  SubjectAssociation,
  WorkforcePerson,
} from "./types.js";

export type OrganizationWrite =
  | { readonly kind: "create_person"; readonly person: WorkforcePerson }
  | { readonly employment: Employment; readonly kind: "create_employment" }
  | { readonly kind: "create_organization_unit"; readonly placement: OrganizationUnitPlacement; readonly unit: OrganizationUnit }
  | { readonly kind: "create_organization_unit_placement"; readonly placement: OrganizationUnitPlacement }
  | { readonly kind: "create_position"; readonly position: Position }
  | { readonly assignment: Assignment; readonly kind: "create_assignment" }
  | { readonly association: SubjectAssociation; readonly kind: "create_subject_association" }
  | { readonly effectiveTo: string; readonly factId: string; readonly kind: "close_assignment" | "close_employment" | "close_organization_unit_placement" | "close_subject_association"; readonly workforcePersonId?: string };

export interface OrganizationCommit {
  readonly actor: ActorReference;
  readonly auditAction: string;
  readonly eventType: string;
  readonly fingerprint: string;
  readonly operationId: string;
  readonly reason: string;
  readonly traceId: string;
  readonly write: OrganizationWrite;
}

export interface OrganizationCommitResult {
  readonly replayed: boolean;
}

export interface OrganizationStore {
  commit(command: OrganizationCommit): Promise<OrganizationCommitResult>;
  findAssignment(assignmentId: string): Promise<Assignment | undefined>;
  findEmployment(employmentId: string): Promise<Employment | undefined>;
  findOrganizationUnit(organizationUnitId: string): Promise<OrganizationUnit | undefined>;
  findOrganizationUnitPlacement(placementId: string): Promise<OrganizationUnitPlacement | undefined>;
  findPosition(positionId: string): Promise<Position | undefined>;
  findSubjectAssociation(associationId: string): Promise<SubjectAssociation | undefined>;
  findWorkforcePerson(workforcePersonId: string): Promise<WorkforcePerson | undefined>;
  listActiveAssignments(workforcePersonId: string, at: string): Promise<readonly Assignment[]>;
  listActiveEmployments(workforcePersonId: string, at: string): Promise<readonly Employment[]>;
  listActivePlacements(organizationUnitId: string, at: string): Promise<readonly OrganizationUnitPlacement[]>;
  listPlacementChangeTimes(from: string, to?: string): Promise<readonly string[]>;
  listActiveSubjectAssociations(subject: AuthenticationSubject, at: string): Promise<readonly SubjectAssociation[]>;
}

export interface OrganizationWriteTarget {
  readonly effectiveAt: string;
  readonly entityId: string;
  readonly entityType: string;
  readonly workforcePersonId?: string;
}

export function describeOrganizationWrite(write: OrganizationWrite): OrganizationWriteTarget {
  if (write.kind === "create_person") return { effectiveAt: write.person.recordedAt, entityId: write.person.workforcePersonId, entityType: "workforce_person", workforcePersonId: write.person.workforcePersonId };
  if (write.kind === "create_employment") return { effectiveAt: write.employment.effectiveFrom, entityId: write.employment.employmentId, entityType: "employment", workforcePersonId: write.employment.workforcePersonId };
  if (write.kind === "create_organization_unit") return { effectiveAt: write.unit.effectiveFrom, entityId: write.unit.organizationUnitId, entityType: "organization_unit" };
  if (write.kind === "create_organization_unit_placement") return { effectiveAt: write.placement.effectiveFrom, entityId: write.placement.placementId, entityType: "organization_unit_placement" };
  if (write.kind === "create_position") return { effectiveAt: write.position.effectiveFrom, entityId: write.position.positionId, entityType: "position" };
  if (write.kind === "create_assignment") return { effectiveAt: write.assignment.effectiveFrom, entityId: write.assignment.assignmentId, entityType: "assignment", workforcePersonId: write.assignment.workforcePersonId };
  if (write.kind === "create_subject_association") return { effectiveAt: write.association.effectiveFrom, entityId: write.association.associationId, entityType: "subject_association", workforcePersonId: write.association.workforcePersonId };
  const entityType = write.kind === "close_employment" ? "employment"
    : write.kind === "close_assignment" ? "assignment"
      : write.kind === "close_organization_unit_placement" ? "organization_unit_placement" : "subject_association";
  return { effectiveAt: write.effectiveTo, entityId: write.factId, entityType, ...(write.workforcePersonId ? { workforcePersonId: write.workforcePersonId } : {}) };
}
