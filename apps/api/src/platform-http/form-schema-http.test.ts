import { randomUUID } from "node:crypto";

import { AuthorizationDeniedError, AuthorizationUnavailableError } from "@ai-crm/platform-authorization";
import { FormSchemaError, type FormSchemaQueryService } from "@ai-crm/platform-form-schema";
import { describe, expect, it, vi } from "vitest";

import { BrowserSessionFailure } from "../auth/errors.js";
import { createFormSchemaHttpAdapter, type FormSchemaHttpRequest } from "./form-schema-http.js";

const traceId = "1234567890abcdef1234567890abcdef";
const assignmentId = "10000000-0000-4000-8000-000000000001";
const release = Object.freeze({
  active: true, contentDigest: "a".repeat(64), definitionId: "platform.synthetic", jsonSchema: {}, ownerModule: "platform.synthetic",
  publishedAt: "2026-07-28T00:00:00.000Z", releaseVersion: 2, uiSchema: { fields: [], layout: "vertical" as const, version: 1 as const }, version: 1 as const,
});

function fixture() {
  const calls: string[] = [];
  const workforcePersonId = randomUUID();
  const authorize = vi.fn(() => {
    calls.push("authorize");
    return Promise.resolve({ activeAssignmentIds: [assignmentId], actorId: "subject.synthetic", assignmentId, traceId, workforcePersonId });
  });
  const getRelease = vi.fn<FormSchemaQueryService["getRelease"]>(() => { calls.push("service"); return Promise.resolve(release); });
  const validateSubmission = vi.fn<FormSchemaQueryService["validateSubmission"]>((input) => {
    calls.push("service");
    return Promise.resolve({ errors: [], reference: { contentDigest: release.contentDigest, definitionId: release.definitionId, releaseVersion: release.releaseVersion, version: 1 }, valid: input.data !== null });
  });
  return { adapter: createFormSchemaHttpAdapter({ authorize, service: { getRelease, validateSubmission } }), authorize, calls, getRelease, validateSubmission, workforcePersonId };
}

function request(overrides: Partial<FormSchemaHttpRequest> = {}): FormSchemaHttpRequest {
  return { at: "2026-07-28T00:00:00.000Z", credential: "opaque-session", method: "GET", path: "/form-definitions/platform.synthetic/releases/2", ...overrides };
}

describe("createFormSchemaHttpAdapter", () => {
  it("reads one exact release and maps authorized identity and permission", async () => {
    const target = fixture();
    const result = await target.adapter.handle(request({ selectedAssignmentId: assignmentId }));

    expect(result).toMatchObject({ body: release, headers: { "Cache-Control": "no-store", "Content-Type": "application/json", "X-Trace-Id": traceId }, status: 200 });
    expect(target.authorize).toHaveBeenCalledWith({ at: "2026-07-28T00:00:00.000Z", credential: "opaque-session", permission: { action: "read", resource: "platform.form-schema.form-release" }, selectedAssignmentId: assignmentId });
    expect(target.getRelease).toHaveBeenCalledWith({
      context: {
        actor: { actorId: "subject.synthetic", actorType: "authenticated_subject", assignmentId },
        subject: { activeAssignmentIds: [assignmentId], selectedAssignmentId: assignmentId, workforcePersonId: target.workforcePersonId },
        traceId,
      },
      definitionId: "platform.synthetic",
      releaseVersion: 2,
    });
  });

  it("ignores a Content-Type header on a bodyless GET", async () => {
    const target = fixture();
    await expect(target.adapter.handle(request({ contentType: "application/json" }))).resolves.toMatchObject({ status: 200 });
    expect(target.getRelease).toHaveBeenCalledOnce();
  });

  it("validates a strict JSON request and invokes the validation query", async () => {
    const target = fixture();
    const result = await target.adapter.handle(request({ body: "{\"data\":{\"value\":1}}", contentType: "application/json; charset=utf-8", method: "POST", path: "/form-definitions/platform.synthetic/releases/2/validate" }));

    expect(result.status).toBe(200);
    expect(target.authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: { action: "validate", resource: "platform.form-schema.form-release" } }));
    expect(target.validateSubmission).toHaveBeenCalledWith(expect.objectContaining({ data: { value: 1 }, definitionId: "platform.synthetic", releaseVersion: 2 }));
    expect(target.calls).toEqual(["authorize", "service"]);
  });

  it.each([
    ["query", { path: "/form-definitions/platform.synthetic/releases/2?current=true" }],
    ["encoded path", { path: "/form-definitions/platform%2Esynthetic/releases/2" }],
    ["leading-zero version", { path: "/form-definitions/platform.synthetic/releases/02" }],
    ["unsafe version", { path: `/form-definitions/platform.synthetic/releases/${String(Number.MAX_SAFE_INTEGER + 1)}` }],
  ])("rejects a non-contract %s without authorization", async (_label, override) => {
    const target = fixture();
    expect((await target.adapter.handle(request(override))).status).toBe(404);
    expect(target.authorize).not.toHaveBeenCalled();
  });

  it("returns 405 with Allow for a contract path using the wrong method", async () => {
    const target = fixture();
    await expect(target.adapter.handle(request({ method: "POST" }))).resolves.toMatchObject({ headers: { Allow: "GET" }, status: 405 });
    expect(target.authorize).not.toHaveBeenCalled();
  });

  it.each([
    ["missing body", { contentType: "application/json" }],
    ["wrong media type", { body: "{\"data\":null}", contentType: "text/plain" }],
    ["malformed JSON", { body: "{", contentType: "application/json" }],
    ["non-object root", { body: "[]", contentType: "application/json" }],
    ["extra property", { body: "{\"data\":null,\"extra\":true}", contentType: "application/json" }],
  ])("rejects %s before authorization", async (_label, override) => {
    const target = fixture();
    const result = await target.adapter.handle(request({ method: "POST", path: "/form-definitions/platform.synthetic/releases/2/validate", ...override }));
    expect(result.status).toBe(400);
    expect(target.calls).toEqual([]);
  });

  it("enforces 256 KiB by encoded UTF-8 bytes before authorization", async () => {
    const target = fixture();
    const body = JSON.stringify({ data: "界".repeat(90_000) });
    const result = await target.adapter.handle(request({ body, contentType: "application/json", method: "POST", path: "/form-definitions/platform.synthetic/releases/2/validate" }));
    expect(result.status).toBe(413);
    expect(target.calls).toEqual([]);
  });

  it("enforces data depth 32 before authorization", async () => {
    const accepted = fixture();
    let boundary: unknown = null;
    for (let depth = 0; depth < 32; depth += 1) boundary = [boundary];
    expect((await accepted.adapter.handle(request({ body: JSON.stringify({ data: boundary }), contentType: "application/json", method: "POST", path: "/form-definitions/platform.synthetic/releases/2/validate" }))).status).toBe(200);
    const target = fixture();
    let data: unknown = null;
    for (let depth = 0; depth < 33; depth += 1) data = [data];
    const result = await target.adapter.handle(request({ body: JSON.stringify({ data }), contentType: "application/json", method: "POST", path: "/form-definitions/platform.synthetic/releases/2/validate" }));
    expect(result.status).toBe(413);
    expect(target.calls).toEqual([]);
  });

  it("counts object, array, and scalar data nodes including the root", async () => {
    const accepted = fixture();
    const exactlyTenThousand = Array.from({ length: 9_999 }, () => null);
    expect((await accepted.adapter.handle(request({ body: JSON.stringify({ data: exactlyTenThousand }), contentType: "application/json", method: "POST", path: "/form-definitions/platform.synthetic/releases/2/validate" }))).status).toBe(200);
    const rejected = fixture();
    const tenThousandAndOne = Array.from({ length: 10_000 }, () => null);
    expect((await rejected.adapter.handle(request({ body: JSON.stringify({ data: tenThousandAndOne }), contentType: "application/json", method: "POST", path: "/form-definitions/platform.synthetic/releases/2/validate" }))).status).toBe(413);
    expect(rejected.calls).toEqual([]);
  });

  it("rejects absent credentials before authorization", async () => {
    const target = fixture();
    expect((await target.adapter.handle({ at: "2026-07-28T00:00:00.000Z", method: "GET", path: "/form-definitions/platform.synthetic/releases/2" })).status).toBe(401);
    expect(target.calls).toEqual([]);
  });

  it("fails closed on malformed trusted actor or trace context", async () => {
    const target = fixture();
    target.authorize.mockResolvedValueOnce({ activeAssignmentIds: [assignmentId], actorId: "client supplied actor", assignmentId, traceId: "bad", workforcePersonId: randomUUID() });
    const result = await target.adapter.handle(request());
    expect(result).toMatchObject({ body: { code: "form_unavailable" }, status: 503 });
    expect(target.getRelease).not.toHaveBeenCalled();
  });

  it("rejects an accessor-backed Assignment set without invoking it", async () => {
    const target = fixture();
    let reads = 0;
    const assignments = [assignmentId];
    Object.defineProperty(assignments, "0", {
      enumerable: true,
      get: () => { reads += 1; return assignmentId; },
    });
    target.authorize.mockResolvedValueOnce({
      activeAssignmentIds: assignments,
      actorId: "subject.synthetic",
      assignmentId,
      traceId,
      workforcePersonId: target.workforcePersonId,
    });

    await expect(target.adapter.handle(request())).resolves.toMatchObject({ status: 503 });
    expect(reads).toBe(0);
    expect(target.getRelease).not.toHaveBeenCalled();
  });

  it.each([
    [new BrowserSessionFailure("authentication_session_invalid"), 401, "form_unauthorized"],
    [new BrowserSessionFailure("authentication_dependency_unavailable"), 503, "form_unavailable"],
    [new AuthorizationDeniedError(randomUUID()), 403, "form_forbidden"],
    [new AuthorizationUnavailableError(), 503, "form_unavailable"],
    [new FormSchemaError("form_not_found"), 404, "form_not_found"],
    [new FormSchemaError("form_schema_rejected"), 422, "form_schema_rejected"],
    [new Error("private detail"), 503, "form_unavailable"],
  ])("maps failures without exposing details", async (failure, status, code) => {
    const target = fixture();
    target.authorize.mockRejectedValueOnce(failure);
    const result = await target.adapter.handle(request());
    expect(result).toMatchObject({ body: { code }, status });
    expect(JSON.stringify(result)).not.toContain("private detail");
  });

  it("maps module validation errors after authorization without retrying", async () => {
    const target = fixture();
    target.validateSubmission.mockRejectedValueOnce(new FormSchemaError("form_invalid_input"));
    const result = await target.adapter.handle(request({ body: "{\"data\":null}", contentType: "application/json", method: "POST", path: "/form-definitions/platform.synthetic/releases/2/validate" }));
    expect(result.status).toBe(400);
    expect(target.calls).toEqual(["authorize"]);
    expect(target.validateSubmission).toHaveBeenCalledTimes(1);
  });
});
