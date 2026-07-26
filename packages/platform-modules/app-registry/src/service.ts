import { AppRegistryError } from "./errors.js";
import type { ApplicationRegistryStore } from "./store.js";
import type { ApplicationRegistryService, RegistryAudit, RegistryAuthorizer, RegistryMutationCommand } from "./types.js";
import { mutationFingerprint, validateActor, validateDeepLink, validateMutation } from "./validation.js";

const target = (command: RegistryMutationCommand): { readonly resourceId: string; readonly resourceType: "application" | "route" } => {
  if (command.kind === "register_application") return { resourceId: command.application.applicationId, resourceType: "application" };
  if (command.kind === "register_route") return { resourceId: command.route.routeId, resourceType: "route" };
  if (command.kind === "register_navigation") return { resourceId: command.navigation.routeId, resourceType: "route" };
  if (command.kind === "set_application_enabled") return { resourceId: command.applicationId, resourceType: "application" };
  return { resourceId: command.routeId, resourceType: "route" };
};

export function createApplicationRegistryService(store: ApplicationRegistryStore, authorizer: RegistryAuthorizer, audit: RegistryAudit): ApplicationRegistryService {
  const recordAudit = async (input: Parameters<RegistryAudit["record"]>[0]): Promise<void> => {
    try { await audit.record(input); }
    catch (error) { throw new AppRegistryError("app_registry_unavailable", { cause: error, retryable: true }); }
  };
  return {
    mutate: async (command) => {
      validateMutation(command);
      const resource = target(command);
      let decision;
      try { decision = await authorizer.authorize({ action: "app_registry:manage", actor: command.actor, ...resource }); }
      catch (error) { throw new AppRegistryError("app_registry_unavailable", { cause: error, retryable: true }); }
      const auditBase = { action: command.kind, actor: command.actor, authorizationDecisionId: decision.decisionId, operationId: command.operationId, reason: command.reason, ...resource, traceId: command.traceId };
      if (!decision.allowed) {
        await recordAudit({ ...auditBase, result: "denied" });
        throw new AppRegistryError("app_registry_denied");
      }
      await recordAudit({ ...auditBase, result: "attempted" });
      let result;
      try { result = await store.commit({ fingerprint: mutationFingerprint(command), mutation: command }); }
      catch (error) {
        await recordAudit({ ...auditBase, result: "failed" });
        if (error instanceof AppRegistryError) throw error;
        throw new AppRegistryError("app_registry_unavailable", { cause: error, retryable: true });
      }
      await recordAudit({ ...auditBase, result: "succeeded" });
      return result;
    },
    loadRegistry: async ({ actor, audience }) => {
      validateActor(actor);
      try {
        const candidates = (await store.listApplications(audience)).filter((item) => item.enabled);
        const applications = [];
        for (const application of candidates) {
          const decision = await authorizer.authorize({ action: "app_registry:view", actor, permissionCode: application.permissionCode, resourceId: application.applicationId, resourceType: "application" });
          if (decision.allowed) applications.push(application);
        }
        const ids = applications.map(({ applicationId }) => applicationId);
        const routeCandidates = (await store.listRoutes(ids)).filter((route) => route.enabled);
        const routes = [];
        for (const route of routeCandidates) {
          const decision = await authorizer.authorize({ action: "app_registry:view", actor, permissionCode: route.permissionCode, resourceId: route.routeId, resourceType: "route" });
          if (decision.allowed) routes.push(route);
        }
        const routeIds = new Set(routes.map(({ routeId }) => routeId));
        const navigation = (await store.listNavigation(ids)).filter((item) => item.enabled && routeIds.has(item.routeId));
        return { applications, navigation, routes, version: 1 };
      } catch (error) {
        if (error instanceof AppRegistryError) throw error;
        throw new AppRegistryError("app_registry_unavailable", { cause: error, retryable: true });
      }
    },
    resolveDeepLink: async ({ actor, audience, link }) => {
      validateActor(actor);
      validateDeepLink(link);
      try {
        const application = await store.findApplication(link.applicationId);
        const route = await store.findRoute(link.routeId);
        if (application === undefined || route === undefined || application.audience !== audience || route.applicationId !== application.applicationId || !application.enabled || !route.enabled || !route.deepLinkSources.includes(link.source)) throw new AppRegistryError("app_registry_target_unavailable");
        const decision = await authorizer.authorize({ action: "app_registry:resolve", actor, permissionCode: route.permissionCode, resourceId: link.resourceReference, resourceType: "route" });
        if (!decision.allowed) throw new AppRegistryError("app_registry_denied");
        return { applicationId: application.applicationId, path: route.path, resourceReference: link.resourceReference, routeId: route.routeId };
      } catch (error) {
        if (error instanceof AppRegistryError) throw error;
        throw new AppRegistryError("app_registry_unavailable", { cause: error, retryable: true });
      }
    },
  };
}
