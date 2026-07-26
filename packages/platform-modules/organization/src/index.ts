export { OrganizationError, type OrganizationErrorCode } from "./errors.js";
export { createMemoryOrganizationStore } from "./memory-store.js";
export { createPostgresOrganizationStore } from "./postgres-store.js";
export { OrganizationService } from "./service.js";
export type { OrganizationStore, OrganizationWrite } from "./store.js";
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
  Position,
  SubjectAssociation,
  WorkforceContext,
  WorkforcePerson,
} from "./types.js";

export const packageId = "@ai-crm/platform-organization" as const;
