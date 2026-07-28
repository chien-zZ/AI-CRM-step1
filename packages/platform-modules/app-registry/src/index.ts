export const packageId = "@ai-crm/platform-app-registry" as const;
export { createPostgresApplicationRegistryCapabilityProbe, type ApplicationRegistryCapabilityProbe, type ApplicationRegistryCapabilityStatus } from "./capability-probe.js";
export { AppRegistryError, type AppRegistryErrorCode } from "./errors.js";
export { createMemoryApplicationRegistryStore } from "./memory-store.js";
export { createPostgresApplicationRegistryStore } from "./postgres-store.js";
export { createPostgresApplicationRegistryQueryService } from "./query-service.js";
export { createApplicationRegistryService } from "./service.js";
export type { AppRegistryPersistenceRuntime } from "./store.js";
export type { ApplicationRegistryQueryService, ApplicationRegistryService, DeepLinkSource, RegisteredApplication, RegisteredDeepLink, RegisteredNavigation, RegisteredRoute, RegistryActor, RegistryAudit, RegistryAudience, RegistryAuthorizationSubject, RegistryAuthorizer, RegistryMutationCommand, RegistryPermissionReference, RegistryQueryAuthorizationRequest, RegistryQueryAuthorizer, RegistryQueryContext, RegistrySnapshot, ResolvedDeepLink } from "./types.js";
