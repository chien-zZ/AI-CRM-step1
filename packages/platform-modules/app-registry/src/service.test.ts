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

  it("maps authorization and audit dependency failures to stable retryable errors", async () => {
    const authorizationUnavailable = createApplicationRegistryService(createMemoryApplicationRegistryStore(), { authorize: () => Promise.reject(new Error("down")) }, audit());
    await expect(authorizationUnavailable.mutate({ ...metadata(), application: app, kind: "register_application" })).rejects.toMatchObject({ code: "app_registry_unavailable", retryable: true });
    const auditUnavailable = createApplicationRegistryService(createMemoryApplicationRegistryStore(), authorizer(), { record: () => Promise.reject(new Error("down")) });
    await expect(auditUnavailable.mutate({ ...metadata(), application: app, kind: "register_application" })).rejects.toMatchObject({ code: "app_registry_unavailable", retryable: true });
  });
});
