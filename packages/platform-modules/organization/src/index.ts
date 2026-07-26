export { OrganizationError, type OrganizationErrorCode } from "./errors.js";
export { createMemoryOrganizationService, createPostgresOrganizationService } from "./factory.js";
export type { OrganizationPersistenceResult, OrganizationPersistenceRuntime } from "./postgres-store.js";
export type {
  ActorReference,
  Assignment,
  AuthenticationSubject,
  CloseEffectiveFactCommand,
  CommandMetadata,
  CreateAssignmentCommand,
  CreateEmploymentCommand,
  CreateOrganizationUnitCommand,
  CreateOrganizationUnitPlacementCommand,
  CreatePositionCommand,
  CreateSubjectAssociationCommand,
  CreateWorkforcePersonCommand,
  EffectiveInterval,
  Employment,
  OrganizationUnit,
  OrganizationUnitPlacement,
  OrganizationCommandAuthorizationRequest,
  OrganizationCommandAuthorizer,
  OrganizationServiceApi,
  Position,
  SubjectAssociation,
  WorkforceContext,
  WorkforcePerson,
} from "./types.js";

export const packageId = "@ai-crm/platform-organization" as const;
