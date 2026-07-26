export const packageId = "@ai-crm/platform-app-registry" as const;
export { AppRegistryError, type AppRegistryErrorCode } from "./errors.js";
export { createMemoryApplicationRegistryStore } from "./memory-store.js";
export { createPostgresApplicationRegistryStore } from "./postgres-store.js";
export { createApplicationRegistryService } from "./service.js";
export type { AppRegistryPersistenceRuntime } from "./store.js";
export type { ApplicationRegistryService, DeepLinkSource, RegisteredApplication, RegisteredDeepLink, RegisteredNavigation, RegisteredRoute, RegistryActor, RegistryAudit, RegistryAudience, RegistryAuthorizer, RegistryMutationCommand, RegistrySnapshot, ResolvedDeepLink } from "./types.js";
