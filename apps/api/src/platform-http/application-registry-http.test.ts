import {
  AppRegistryError,
  type ApplicationRegistryQueryService,
} from "@ai-crm/platform-app-registry";
import { describe, expect, it, vi } from "vitest";

import { createApplicationRegistryHttpAdapter } from "./application-registry-http.js";

const context = Object.freeze({
  activeAssignmentIds: Object.freeze(["11111111-1111-4111-8111-111111111111"]),
  actorId: "subject.synthetic",
  assignmentId: "11111111-1111-4111-8111-111111111111",
  traceId: "1234567890abcdef1234567890abcdef",
  workforcePersonId: "22222222-2222-4222-8222-222222222222",
});
const link = Object.freeze({
  applicationId: "platform.synthetic",
  resourceReference: "synthetic:123",
  routeId: "platform.synthetic.detail",
  source: "task",
  version: 1,
});
const snapshot = Object.freeze({ applications: [], navigation: [], routes: [], version: 1 as const });
const resolved = Object.freeze({
  applicationId: link.applicationId,
  path: "/platform/synthetic/:id",
  resourceReference: link.resourceReference,
  routeId: link.routeId,
});

function fixture() {
  const service = {
    loadRegistry: vi.fn<ApplicationRegistryQueryService["loadRegistry"]>(() => Promise.resolve(snapshot)),
    resolveDeepLink: vi.fn<ApplicationRegistryQueryService["resolveDeepLink"]>(() => Promise.resolve(resolved)),
  };
  return { adapter: createApplicationRegistryHttpAdapter(service), service };
}

describe("createApplicationRegistryHttpAdapter", () => {
  it("maps the trusted authenticated context to an internal registry Actor", async () => {
    const { adapter, service } = fixture();

    await expect(adapter.loadRegistry(context)).resolves.toEqual({
      body: snapshot,
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'",
        "X-Trace-Id": context.traceId,
      },
      status: 200,
    });
    expect(service.loadRegistry).toHaveBeenCalledWith({
      audience: "internal",
      context: {
        actor: {
          actorId: context.actorId,
          actorType: "authenticated_subject",
          assignmentId: context.assignmentId,
          workforcePersonId: context.workforcePersonId,
        },
        subject: {
          activeAssignmentIds: context.activeAssignmentIds,
          selectedAssignmentId: context.assignmentId,
          workforcePersonId: context.workforcePersonId,
        },
        traceId: context.traceId,
      },
    });
  });

  it("passes only a strictly validated deep-link descriptor and internal audience", async () => {
    const { adapter, service } = fixture();

    await expect(adapter.resolveDeepLink(context, link)).resolves.toMatchObject({ body: resolved, status: 200 });
    const request = service.resolveDeepLink.mock.calls[0]?.[0];
    expect(request?.context.actor).toMatchObject({ actorId: context.actorId, actorType: "authenticated_subject" });
    expect(request?.audience).toBe("internal");
    expect(request?.link).toEqual(link);
  });

  it.each([
    undefined,
    { ...link, version: 2 },
    { ...link, source: "email" },
    { ...link, routeId: "https://outside.example/path" },
    { ...link, resourceReference: "secret?token=value" },
    { ...link, token: "must-not-cross-boundary" },
  ])("rejects malformed or widened deep-link input before the service call", async (body) => {
    const { adapter, service } = fixture();

    await expect(adapter.resolveDeepLink(context, body)).resolves.toMatchObject({
      body: { code: "app_registry_invalid_input" },
      status: 400,
    });
    expect(service.resolveDeepLink).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { ...context, actorId: "https://identity.invalid/sub" },
    { ...context, traceId: "0".repeat(32) },
    { ...context, workforcePersonId: "not-a-uuid" },
    { ...context, role: "administrator" },
  ])("fails malformed authenticated context closed without invoking the module", async (requestContext) => {
    const { adapter, service } = fixture();

    await expect(adapter.loadRegistry(requestContext)).resolves.toMatchObject({
      body: { code: "app_registry_unauthorized" },
      status: 401,
    });
    expect(service.loadRegistry).not.toHaveBeenCalled();
  });

  it("rejects an accessor-backed Assignment set without invoking it", async () => {
    const { adapter, service } = fixture();
    let reads = 0;
    const assignments = [context.assignmentId];
    Object.defineProperty(assignments, "0", {
      enumerable: true,
      get: () => { reads += 1; return context.assignmentId; },
    });

    await expect(adapter.loadRegistry({ ...context, activeAssignmentIds: assignments })).resolves.toMatchObject({ status: 401 });
    expect(reads).toBe(0);
    expect(service.loadRegistry).not.toHaveBeenCalled();
  });

  it.each([
    ["app_registry_invalid_input", 400],
    ["app_registry_denied", 403],
    ["app_registry_target_unavailable", 404],
    ["app_registry_operation_conflict", 409],
    ["app_registry_unavailable", 503],
  ] as const)("maps %s to its stable status without exposing causes", async (code, status) => {
    const { adapter, service } = fixture();
    service.resolveDeepLink.mockRejectedValueOnce(new AppRegistryError(code, { cause: new Error("private-store-detail") }));

    const response = await adapter.resolveDeepLink(context, link);

    expect(response).toMatchObject({ body: { code }, status });
    expect(JSON.stringify(response)).not.toContain("private-store-detail");
    expect(response.headers["X-Trace-Id"]).toBe(context.traceId);
  });

  it("maps unexpected dependency failures to a sanitized retryable surface", async () => {
    const { adapter, service } = fixture();
    service.loadRegistry.mockRejectedValueOnce(new Error("connection string and SQL details"));

    const response = await adapter.loadRegistry(context);

    expect(response).toMatchObject({
      body: { code: "app_registry_unavailable" },
      status: 503,
    });
    expect(JSON.stringify(response)).not.toContain("connection string");
  });
});
