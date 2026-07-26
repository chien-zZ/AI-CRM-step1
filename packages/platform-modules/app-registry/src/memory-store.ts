import { AppRegistryError } from "./errors.js";
import type { ApplicationRegistryStore, RegistryCommit } from "./store.js";
import type { RegisteredApplication, RegisteredNavigation, RegisteredRoute } from "./types.js";

export function createMemoryApplicationRegistryStore(): ApplicationRegistryStore {
  const applications = new Map<string, RegisteredApplication>();
  const routes = new Map<string, RegisteredRoute>();
  const navigation = new Map<string, RegisteredNavigation>();
  const receipts = new Map<string, string>();
  return {
    commit: ({ fingerprint, mutation }: RegistryCommit) => {
      const prior = receipts.get(mutation.operationId);
      if (prior !== undefined) {
        if (prior !== fingerprint) throw new AppRegistryError("app_registry_operation_conflict");
        return Promise.resolve({ replayed: true });
      }
      if (mutation.kind === "register_application") {
        if (applications.has(mutation.application.applicationId)) throw new AppRegistryError("app_registry_operation_conflict");
        applications.set(mutation.application.applicationId, structuredClone(mutation.application));
      }
      if (mutation.kind === "register_route") {
        const app = applications.get(mutation.route.applicationId);
        if (app === undefined || routes.has(mutation.route.routeId)) throw new AppRegistryError("app_registry_operation_conflict");
        routes.set(mutation.route.routeId, structuredClone(mutation.route));
      }
      if (mutation.kind === "register_navigation") {
        const route = routes.get(mutation.navigation.routeId);
        const parent = mutation.navigation.parentNavigationId === undefined ? undefined : navigation.get(mutation.navigation.parentNavigationId);
        if (route?.applicationId !== mutation.navigation.applicationId || navigation.has(mutation.navigation.navigationId) || mutation.navigation.parentNavigationId === mutation.navigation.navigationId || (mutation.navigation.parentNavigationId !== undefined && parent?.applicationId !== mutation.navigation.applicationId)) throw new AppRegistryError("app_registry_operation_conflict");
        navigation.set(mutation.navigation.navigationId, structuredClone(mutation.navigation));
      }
      if (mutation.kind === "set_application_enabled") {
        const app = applications.get(mutation.applicationId);
        if (app === undefined) throw new AppRegistryError("app_registry_target_unavailable");
        applications.set(app.applicationId, { ...app, enabled: mutation.enabled });
      }
      if (mutation.kind === "set_route_enabled") {
        const route = routes.get(mutation.routeId);
        if (route === undefined) throw new AppRegistryError("app_registry_target_unavailable");
        routes.set(route.routeId, { ...route, enabled: mutation.enabled });
      }
      receipts.set(mutation.operationId, fingerprint);
      return Promise.resolve({ replayed: false });
    },
    findApplication: (id) => Promise.resolve(applications.has(id) ? structuredClone(applications.get(id)) : undefined),
    findRoute: (id) => Promise.resolve(routes.has(id) ? structuredClone(routes.get(id)) : undefined),
    listApplications: (audience) => Promise.resolve(structuredClone([...applications.values()].filter((item) => item.audience === audience).sort((a, b) => a.applicationId.localeCompare(b.applicationId)))),
    listNavigation: (ids) => Promise.resolve(structuredClone([...navigation.values()].filter((item) => ids.includes(item.applicationId)).sort((a, b) => a.order - b.order || a.navigationId.localeCompare(b.navigationId)))),
    listRoutes: (ids) => Promise.resolve(structuredClone([...routes.values()].filter((item) => ids.includes(item.applicationId)).sort((a, b) => a.routeId.localeCompare(b.routeId)))),
  };
}
