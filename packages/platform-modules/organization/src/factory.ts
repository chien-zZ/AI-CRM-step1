import { createMemoryOrganizationStore } from "./memory-store.js";
import { createPostgresOrganizationStore, type OrganizationPersistenceRuntime } from "./postgres-store.js";
import { OrganizationService } from "./service.js";
import type { OrganizationCommandAuthorizer, OrganizationServiceApi } from "./types.js";

export function createMemoryOrganizationService(authorizer: OrganizationCommandAuthorizer): OrganizationServiceApi {
  return new OrganizationService(createMemoryOrganizationStore(), authorizer);
}

export function createPostgresOrganizationService(
  executor: OrganizationPersistenceRuntime,
  authorizer: OrganizationCommandAuthorizer,
): OrganizationServiceApi {
  return new OrganizationService(createPostgresOrganizationStore(executor), authorizer);
}
