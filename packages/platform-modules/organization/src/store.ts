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
  listActiveSubjectAssociations(subject: AuthenticationSubject, at: string): Promise<readonly SubjectAssociation[]>;
}
