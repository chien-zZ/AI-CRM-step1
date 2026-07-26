export interface EffectiveInterval {
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

export interface AuthenticationSubject {
  readonly issuer: string;
  readonly subject: string;
}

export interface ActorReference {
  readonly actorId: string;
  readonly actorType: "authenticated_subject" | "system";
}

export interface CommandMetadata {
  readonly actor: ActorReference;
  readonly operationId: string;
  readonly reason: string;
  readonly traceId: string;
}

export interface OrganizationCommandAuthorizationRequest {
  readonly action: string;
  readonly actor: ActorReference;
  readonly entityId: string;
  readonly entityType: string;
  readonly operationId: string;
}

export interface OrganizationCommandAuthorizer {
  authorize(request: OrganizationCommandAuthorizationRequest): Promise<void>;
}

export interface OrganizationServiceApi {
  closeAssignment(command: CloseEffectiveFactCommand): Promise<void>;
  closeEmployment(command: CloseEffectiveFactCommand): Promise<void>;
  closeOrganizationUnitPlacement(command: CloseEffectiveFactCommand): Promise<void>;
  closeSubjectAssociation(command: CloseEffectiveFactCommand): Promise<void>;
  createAssignment(command: CreateAssignmentCommand): Promise<void>;
  createEmployment(command: CreateEmploymentCommand): Promise<void>;
  createOrganizationUnit(command: CreateOrganizationUnitCommand): Promise<void>;
  createOrganizationUnitPlacement(command: CreateOrganizationUnitPlacementCommand): Promise<void>;
  createPosition(command: CreatePositionCommand): Promise<void>;
  createSubjectAssociation(command: CreateSubjectAssociationCommand): Promise<void>;
  createWorkforcePerson(command: CreateWorkforcePersonCommand): Promise<void>;
  resolveWorkforceContext(subject: AuthenticationSubject, at: string, assignmentId?: string): Promise<WorkforceContext>;
}

export interface WorkforcePerson {
  readonly workforcePersonId: string;
  readonly recordedAt: string;
}

export interface Employment extends EffectiveInterval {
  readonly employmentId: string;
  readonly workforcePersonId: string;
}

export interface OrganizationUnit extends EffectiveInterval {
  readonly organizationUnitId: string;
}

export interface OrganizationUnitPlacement extends EffectiveInterval {
  readonly organizationUnitId: string;
  readonly parentOrganizationUnitId?: string;
  readonly placementId: string;
}

export interface Position extends EffectiveInterval {
  readonly organizationUnitId: string;
  readonly positionId: string;
}

export interface Assignment extends EffectiveInterval {
  readonly assignmentId: string;
  readonly employmentId: string;
  readonly organizationUnitId: string;
  readonly positionId: string;
  readonly workforcePersonId: string;
}

export interface SubjectAssociation extends AuthenticationSubject, EffectiveInterval {
  readonly associationId: string;
  readonly workforcePersonId: string;
}

export interface WorkforceAssignmentReference {
  readonly assignmentId: string;
  readonly employmentId: string;
  readonly organizationUnitId: string;
  readonly positionId: string;
}

export interface WorkforceContext {
  readonly assignments: readonly WorkforceAssignmentReference[];
  readonly employmentIds: readonly string[];
  readonly resolvedAt: string;
  readonly subject: AuthenticationSubject;
  readonly workforcePersonId: string;
}

export interface CreateWorkforcePersonCommand extends CommandMetadata {
  readonly recordedAt: string;
  readonly workforcePersonId: string;
}

export interface CreateEmploymentCommand extends CommandMetadata, EffectiveInterval {
  readonly employmentId: string;
  readonly workforcePersonId: string;
}

export interface CreateOrganizationUnitCommand extends CommandMetadata, EffectiveInterval {
  readonly organizationUnitId: string;
  readonly parentOrganizationUnitId?: string;
  readonly placementId: string;
}

export interface CreateOrganizationUnitPlacementCommand extends CommandMetadata, EffectiveInterval {
  readonly organizationUnitId: string;
  readonly parentOrganizationUnitId?: string;
  readonly placementId: string;
}

export interface CreatePositionCommand extends CommandMetadata, EffectiveInterval {
  readonly organizationUnitId: string;
  readonly positionId: string;
}

export interface CreateAssignmentCommand extends CommandMetadata, EffectiveInterval {
  readonly assignmentId: string;
  readonly employmentId: string;
  readonly organizationUnitId: string;
  readonly positionId: string;
  readonly workforcePersonId: string;
}

export interface CreateSubjectAssociationCommand extends AuthenticationSubject, CommandMetadata, EffectiveInterval {
  readonly associationId: string;
  readonly workforcePersonId: string;
}

export interface CloseEffectiveFactCommand extends CommandMetadata {
  readonly effectiveTo: string;
  readonly factId: string;
}
