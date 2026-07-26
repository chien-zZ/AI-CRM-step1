import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createApplicationRegistryService, createMemoryApplicationRegistryStore, type RegistryAudit, type RegistryAuthorizer, type RegistryMutationCommand } from "./index.js";

const actor = { actorId: "subject.synthetic", actorType: "authenticated_subject" as const };
const traceId = "1234567890abcdef1234567890abcdef";
const authorizer = (allow = true) => ({ authorize: vi.fn<RegistryAuthorizer["authorize"]>(() => Promise.resolve({ allowed: allow, decisionId: randomUUID() })) }) satisfies RegistryAuthorizer;
const audit = (): RegistryAudit & { record: ReturnType<typeof vi.fn> } => ({ record: vi.fn(() => Promise.resolve()) });
const metadata = () => ({ actor, operationId: randomUUID(), reason: "synthetic setup", traceId });
const app = { applicationId: "platform.synthetic", audience: "internal" as const, enabled: true, permissionCode: "platform.synthetic:view" };
const route = { applicationId: app.applicationId, deepLinkSources: ["task", "notification"] as const, enabled: true, path: "/platform/synthetic/:resource_reference", permissionCode: "platform.synthetic:open", routeId: "platform.synthetic.detail" };

const setup = async (authorization = authorizer()) => {
  const store = createMemoryApplicationRegistryStore();
  const recorder = audit();
  const service = createApplicationRegistryService(store, authorization, recorder);
  await service.mutate({ ...metadata(), application: app, kind: "register_application" });
  await service.mutate({ ...metadata(), kind: "register_route", route });
  await service.mutate({ ...metadata(), kind: "register_navigation", navigation: { applicationId: app.applicationId, enabled: true, navigationId: "platform.synthetic.nav", order: 10, routeId: route.routeId } });
  return { recorder, service };
};

describe("application registry", () => {
  it("loads only enabled records for the requested audience and current permissions", async () => {
    const { service } = await setup();
    await expect(service.loadRegistry({ actor, audience: "internal" })).resolves.toMatchObject({ applications: [app], routes: [route], version: 1 });
    await expect(service.loadRegistry({ actor, audience: "external" })).resolves.toEqual({ applications: [], navigation: [], routes: [], version: 1 });
  });

  it("resolves registered task and notification links with target reauthorization", async () => {
    const authorization = authorizer();
    const { service } = await setup(authorization);
    const link = { applicationId: app.applicationId, resourceReference: "synthetic:123", routeId: route.routeId, source: "task" as const, version: 1 as const };
    await expect(service.resolveDeepLink({ actor, audience: "internal", link })).resolves.toEqual({ applicationId: app.applicationId, path: route.path, resourceReference: "synthetic:123", routeId: route.routeId });
    expect(authorization.authorize.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ action: "app_registry:resolve", permissionCode: route.permissionCode, resourceId: "synthetic:123" }));
  });

  it("blocks old deep links after route disablement and rejects arbitrary URLs", async () => {
    const { service } = await setup();
    await service.mutate({ ...metadata(), enabled: false, kind: "set_route_enabled", routeId: route.routeId });
    const link = { applicationId: app.applicationId, resourceReference: "synthetic:123", routeId: route.routeId, source: "notification" as const, version: 1 as const };
    await expect(service.resolveDeepLink({ actor, audience: "internal", link })).rejects.toMatchObject({ code: "app_registry_target_unavailable" });
    await expect(service.mutate({ ...metadata(), kind: "register_route", route: { ...route, path: "https://outside.example/path", routeId: "platform.synthetic.outside" } })).rejects.toMatchObject({ code: "app_registry_invalid_input" });
  });

  it("denies deep-link resolution when current target authorization is denied", async () => {
    const authorization = authorizer();
    const { service } = await setup(authorization);
    authorization.authorize.mockResolvedValueOnce({ allowed: false, decisionId: randomUUID() });
    const link = { applicationId: app.applicationId, resourceReference: "synthetic:denied", routeId: route.routeId, source: "task" as const, version: 1 as const };
    await expect(service.resolveDeepLink({ actor, audience: "internal", link })).rejects.toMatchObject({ code: "app_registry_denied" });
    expect(authorization.authorize).toHaveBeenCalledTimes(4);
  });

  it("requires both current application and route authorization for deep links", async () => {
    const authorization = authorizer();
    const { service } = await setup(authorization);
    authorization.authorize.mockClear();
    authorization.authorize.mockResolvedValueOnce({ allowed: false, decisionId: randomUUID() }).mockResolvedValueOnce({ allowed: true, decisionId: randomUUID() });
    const link = { applicationId: app.applicationId, resourceReference: "synthetic:app-denied", routeId: route.routeId, source: "task" as const, version: 1 as const };
    await expect(service.resolveDeepLink({ actor, audience: "internal", link })).rejects.toMatchObject({ code: "app_registry_denied" });
    expect(authorization.authorize).toHaveBeenCalledOnce();
    expect(authorization.authorize).toHaveBeenCalledWith(expect.objectContaining({ permissionCode: app.permissionCode, resourceId: app.applicationId, resourceType: "application" }));
  });

  it("fails closed on denied management and records the denial before mutation", async () => {
    const recorder = audit();
    const service = createApplicationRegistryService(createMemoryApplicationRegistryStore(), authorizer(false), recorder);
    await expect(service.mutate({ ...metadata(), application: app, kind: "register_application" })).rejects.toMatchObject({ code: "app_registry_denied" });
    expect(recorder.record).toHaveBeenCalledWith(expect.objectContaining({ result: "denied" }));
    await expect(service.loadRegistry({ actor, audience: "internal" })).resolves.toEqual({ applications: [], navigation: [], routes: [], version: 1 });
  });

  it("replays identical operations, rejects changed payloads, and audits outcomes", async () => {
    const store = createMemoryApplicationRegistryStore();
    const recorder = audit();
    const service = createApplicationRegistryService(store, authorizer(), recorder);
    const command: RegistryMutationCommand = { ...metadata(), application: app, kind: "register_application" };
    await expect(service.mutate(command)).resolves.toEqual({ replayed: false });
    await expect(service.mutate(command)).resolves.toEqual({ replayed: true });
    await expect(service.mutate({ ...command, application: { ...app, enabled: false } })).rejects.toMatchObject({ code: "app_registry_operation_conflict" });
    expect(recorder.record).toHaveBeenCalledWith(expect.objectContaining({ result: "failed" }));
  });

  it("uses canonical fingerprints for reordered object keys and deep-link source sets", async () => {
    const service = createApplicationRegistryService(createMemoryApplicationRegistryStore(), authorizer(), audit());
    await service.mutate({ ...metadata(), application: app, kind: "register_application" });
    const operationId = randomUUID();
    const first: RegistryMutationCommand = { actor, kind: "register_route", operationId, reason: "canonical retry", route, traceId };
    const reordered = {
      traceId,
      route: { routeId: route.routeId, permissionCode: route.permissionCode, path: route.path, enabled: route.enabled, deepLinkSources: ["notification", "task"], applicationId: route.applicationId },
      reason: "canonical retry",
      operationId,
      kind: "register_route",
      actor: { actorType: actor.actorType, actorId: actor.actorId },
    } as RegistryMutationCommand;
    await expect(service.mutate(first)).resolves.toEqual({ replayed: false });
    await expect(service.mutate(reordered)).resolves.toEqual({ replayed: true });
  });

  it("rejects extra keys, invalid runtime enums and scalar types, and self-parent navigation", async () => {
    const service = createApplicationRegistryService(createMemoryApplicationRegistryStore(), authorizer(), audit());
    await expect(service.mutate({ ...metadata(), application: { ...app, audience: "partner" }, kind: "register_application" } as never)).rejects.toMatchObject({ code: "app_registry_invalid_input" });
    await expect(service.mutate({ ...metadata(), application: { ...app, token: "secret" }, kind: "register_application" } as never)).rejects.toMatchObject({ code: "app_registry_invalid_input" });
    await expect(service.mutate({ ...metadata(), application: { ...app, enabled: "yes" }, kind: "register_application" } as never)).rejects.toMatchObject({ code: "app_registry_invalid_input" });
    await expect(service.mutate({ ...metadata(), kind: "register_route", route: { ...route, deepLinkSources: ["email"] } } as never)).rejects.toMatchObject({ code: "app_registry_invalid_input" });
    await expect(service.mutate({ ...metadata(), application: app, kind: "register_application", token: "secret" } as never)).rejects.toMatchObject({ code: "app_registry_invalid_input" });
    await expect(service.mutate({ ...metadata(), kind: "register_navigation", navigation: { applicationId: app.applicationId, enabled: true, navigationId: "platform.self", order: 1, parentNavigationId: "platform.self", routeId: route.routeId } })).rejects.toMatchObject({ code: "app_registry_invalid_input" });
    await expect(service.loadRegistry({ actor: { ...actor, actorType: "admin" }, audience: "internal" } as never)).rejects.toMatchObject({ code: "app_registry_invalid_input" });
  });

  it("returns an ancestor-closed navigation snapshot", async () => {
    const authorization = authorizer();
    const store = createMemoryApplicationRegistryStore();
    const service = createApplicationRegistryService(store, authorization, audit());
    await service.mutate({ ...metadata(), application: app, kind: "register_application" });
    await service.mutate({ ...metadata(), kind: "register_route", route });
    const childRoute = { ...route, deepLinkSources: ["task"] as const, permissionCode: "platform.child:open", routeId: "platform.synthetic.child" };
    await service.mutate({ ...metadata(), kind: "register_route", route: childRoute });
    await service.mutate({ ...metadata(), kind: "register_navigation", navigation: { applicationId: app.applicationId, enabled: false, navigationId: "platform.disabled.parent", order: 1, routeId: route.routeId } });
    await service.mutate({ ...metadata(), kind: "register_navigation", navigation: { applicationId: app.applicationId, enabled: true, navigationId: "platform.disabled.child", order: 2, parentNavigationId: "platform.disabled.parent", routeId: childRoute.routeId } });
    await service.mutate({ ...metadata(), kind: "register_navigation", navigation: { applicationId: app.applicationId, enabled: true, navigationId: "platform.denied.parent", order: 3, routeId: route.routeId } });
    await service.mutate({ ...metadata(), kind: "register_navigation", navigation: { applicationId: app.applicationId, enabled: true, navigationId: "platform.denied.child", order: 4, parentNavigationId: "platform.denied.parent", routeId: childRoute.routeId } });
    authorization.authorize.mockImplementation((request) => Promise.resolve({ allowed: request.action !== "app_registry:view" || request.permissionCode !== route.permissionCode, decisionId: randomUUID() }));
    const snapshot = await service.loadRegistry({ actor, audience: "internal" });
    expect(snapshot.navigation).toEqual([]);
    expect(snapshot.routes).toEqual([childRoute]);
  });

  it("does not expose mutable references from the memory store", async () => {
    const store = createMemoryApplicationRegistryStore();
    const service = createApplicationRegistryService(store, authorizer(), audit());
    await service.mutate({ ...metadata(), application: app, kind: "register_application" });
    await service.mutate({ ...metadata(), kind: "register_route", route });
    const navigation = { applicationId: app.applicationId, enabled: true, navigationId: "platform.synthetic.mutable", order: 1, routeId: route.routeId };
    await service.mutate({ ...metadata(), kind: "register_navigation", navigation });
    const foundApplication = await store.findApplication(app.applicationId);
    const foundRoute = await store.findRoute(route.routeId);
    const listedApplications = await store.listApplications("internal");
    const listedNavigation = await store.listNavigation([app.applicationId]);
    const listedRoutes = await store.listRoutes([app.applicationId]);
    (foundApplication as { enabled: boolean }).enabled = false;
    (foundRoute?.deepLinkSources as string[]).splice(0);
    (listedApplications[0] as { permissionCode: string }).permissionCode = "changed:value";
    (listedNavigation[0] as { enabled: boolean }).enabled = false;
    (listedRoutes[0] as { enabled: boolean }).enabled = false;
    await expect(store.findApplication(app.applicationId)).resolves.toEqual(app);
    await expect(store.findRoute(route.routeId)).resolves.toEqual(route);
    await expect(store.listNavigation([app.applicationId])).resolves.toEqual([navigation]);
  });

  it("maps authorization and audit dependency failures to stable retryable errors", async () => {
    const authorizationUnavailable = createApplicationRegistryService(createMemoryApplicationRegistryStore(), { authorize: () => Promise.reject(new Error("down")) }, audit());
    await expect(authorizationUnavailable.mutate({ ...metadata(), application: app, kind: "register_application" })).rejects.toMatchObject({ code: "app_registry_unavailable", retryable: true });
    const auditUnavailable = createApplicationRegistryService(createMemoryApplicationRegistryStore(), authorizer(), { record: () => Promise.reject(new Error("down")) });
    await expect(auditUnavailable.mutate({ ...metadata(), application: app, kind: "register_application" })).rejects.toMatchObject({ code: "app_registry_unavailable", retryable: true });
  });
});
