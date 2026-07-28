import { randomUUID } from "node:crypto";
import { AuthorizationDeniedError, AuthorizationUnavailableError } from "@ai-crm/platform-authorization";
import { FileCenterError, type FileActor, type FileCenterService } from "@ai-crm/platform-file-center";
import { describe, expect, it, vi } from "vitest";

import { BrowserSessionFailure } from "../auth/errors.js";
import { createFileCenterHttpAdapter, type FileCenterHttpRequestContext } from "./file-center-http.js";

const credential = "c".repeat(43);
const csrfToken = "x".repeat(43);
const actor: FileActor = Object.freeze({
  actorId: "00000000-0000-4000-8000-000000000051",
  actorType: "authenticated_subject",
  assignmentId: "00000000-0000-4000-8000-000000000052",
});
const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
const traceparent = `00-${traceId}-00f067aa0ba902b7-01`;
const ids = Object.freeze({
  content: "00000000-0000-4000-8000-000000000061",
  file: "00000000-0000-4000-8000-000000000062",
  operation: "00000000-0000-4000-8000-000000000063",
  session: "00000000-0000-4000-8000-000000000064",
});

const fileReference = Object.freeze({
  contentVersionId: ids.content,
  displayName: "synthetic.txt",
  fileId: ids.file,
  version: 1 as const,
});
const uploadSession = Object.freeze({
  contentVersionId: ids.content,
  createdAt: "2026-07-28T01:00:00.000Z",
  expiresAt: "2026-07-28T01:05:00.000Z",
  fileId: ids.file,
  sessionId: ids.session,
  status: "created" as const,
  version: 1 as const,
});
const contentVersion = Object.freeze({
  actualSizeBytes: 7,
  completedAt: "2026-07-28T01:01:00.000Z",
  contentVersionId: ids.content,
  createdAt: "2026-07-28T01:00:00.000Z",
  declaredMediaType: "text/plain",
  declaredSizeBytes: 7,
  detectedMediaType: "text/plain",
  fileId: ids.file,
  status: "pending_scan" as const,
  version: 1 as const,
  versionNumber: 1,
});

function context(overrides: Partial<FileCenterHttpRequestContext> = {}): FileCenterHttpRequestContext {
  return {
    cookie: `__Host-ai_crm_pc_session=${credential}`,
    csrfToken,
    idempotencyKey: ids.operation,
    origin: "https://workbench.example.test",
    selectedAssignmentId: actor.assignmentId,
    traceparent,
    ...overrides,
  };
}

function createBody() {
  return { declaredMediaType: "TEXT/plain", declaredSizeBytes: 7, displayName: "synthetic.txt", ownerModule: "platform.synthetic" };
}

function downloadBody() {
  return {
    fileReference,
    resource: { resourceId: "synthetic:1", resourceType: "platform.synthetic" },
  };
}

function fixture() {
  const service = {
    authorizeDownload: vi.fn<Pick<FileCenterService, "authorizeDownload">["authorizeDownload"]>().mockResolvedValue({
      downloadUrl: "https://download.example.test/short-lived?signature=synthetic",
      expiresAt: "2026-07-28T01:02:00.000Z",
      fileReference,
      version: 1,
    }),
    completeUpload: vi.fn<Pick<FileCenterService, "completeUpload">["completeUpload"]>().mockResolvedValue({ contentVersion, replayed: false }),
    createUploadSession: vi.fn<Pick<FileCenterService, "createUploadSession">["createUploadSession"]>().mockResolvedValue({
      fileReference,
      replayed: false,
      session: uploadSession,
      uploadGrant: {
        expiresAt: uploadSession.expiresAt,
        headers: { "Content-Type": "text/plain" },
        method: "PUT",
        uploadUrl: "https://upload.example.test/short-lived?signature=synthetic",
        version: 1,
      },
    }),
  };
  const sessions = {
    sessionForMutation: vi.fn().mockResolvedValue({
      authenticatedAt: "2026-07-28T00:00:00.000Z",
      client: "pc-web",
      csrfToken,
      expiresAt: "2026-07-28T08:00:00.000Z",
      sessionReference: "s".repeat(43),
    }),
  };
  const actorResolver = { resolve: vi.fn().mockResolvedValue(actor) };
  return {
    actorResolver,
    adapter: createFileCenterHttpAdapter({ actorResolver, allowedOrigins: ["https://workbench.example.test"], service, sessions }),
    service,
    sessions,
  };
}

describe("File Center HTTP adapter", () => {
  it("maps a secure create request to server-owned command metadata and a bounded public result", async () => {
    const runtime = fixture();
    const leakyResult = {
      fileReference,
      replayed: true,
      session: { ...uploadSession, objectHandle: "private/object" } as never,
      uploadGrant: {
        expiresAt: uploadSession.expiresAt,
        headers: { "Content-Type": "text/plain" },
        method: "PUT",
        providerPayload: { bucket: "private" },
        uploadUrl: "https://upload.example.test/short-lived?signature=synthetic",
        version: 1,
      } as never,
    } as unknown as Awaited<ReturnType<FileCenterService["createUploadSession"]>>;
    runtime.service.createUploadSession.mockResolvedValueOnce(leakyResult);

    const response = await runtime.adapter.createUpload(context(), createBody());

    expect(response).toMatchObject({ body: { replayed: true }, headers: { "Cache-Control": "no-store" }, status: 201 });
    expect(runtime.service.createUploadSession).toHaveBeenCalledWith({
      actor,
      declaredMediaType: "text/plain",
      declaredSizeBytes: 7,
      displayName: "synthetic.txt",
      operationId: ids.operation,
      ownerModule: "platform.synthetic",
      reason: "file_http:create_upload",
      traceId,
    });
    expect(runtime.actorResolver.resolve).toHaveBeenCalledWith({ credential, operation: "upload", selectedAssignmentId: actor.assignmentId, traceId });
    expect(JSON.stringify(response)).not.toMatch(/bucket|objectHandle|providerPayload|private\/object/u);
  });

  it.each([
    ["untrusted Origin", { origin: "https://attacker.example.test" }],
    ["missing Origin and Referer", { origin: undefined }],
    ["wrong CSRF token", { csrfToken: "not-the-session-token" }],
  ])("rejects %s before actor resolution and mutation", async (_name, overrides) => {
    const runtime = fixture();
    const response = await runtime.adapter.createUpload(context(overrides), createBody());

    expect(response).toMatchObject({ body: { code: "authentication_csrf_rejected" }, status: 403 });
    expect(runtime.actorResolver.resolve).not.toHaveBeenCalled();
    expect(runtime.service.createUploadSession).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID idempotency key before touching session, actor, or service", async () => {
    const runtime = fixture();
    const response = await runtime.adapter.createUpload(context({ idempotencyKey: "retry-me" }), createBody());

    expect(response).toMatchObject({ body: { code: "file_center_invalid_input" }, status: 400 });
    expect(runtime.sessions.sessionForMutation).not.toHaveBeenCalled();
    expect(runtime.actorResolver.resolve).not.toHaveBeenCalled();
    expect(runtime.service.createUploadSession).not.toHaveBeenCalled();
  });

  it("rejects unknown and accessor-bearing body fields without reading an accessor", async () => {
    const runtime = fixture();
    let reads = 0;
    const accessor = Object.defineProperty(createBody(), "ownerModule", { enumerable: true, get: () => { reads += 1; return "platform.synthetic"; } });

    await expect(runtime.adapter.createUpload(context(), { ...createBody(), actor })).resolves.toMatchObject({ status: 400 });
    await expect(runtime.adapter.createUpload(context(), accessor)).resolves.toMatchObject({ status: 400 });
    expect(reads).toBe(0);
    expect(runtime.service.createUploadSession).not.toHaveBeenCalled();
  });

  it("confirms by UUID and preserves the service replay result without storage internals", async () => {
    const runtime = fixture();
    runtime.service.completeUpload.mockResolvedValueOnce({ contentVersion: { ...contentVersion, objectHandle: "private/object", provider: { etag: "secret" } } as never, replayed: true });

    const response = await runtime.adapter.confirmUpload(context(), ids.session.toUpperCase());

    expect(response).toMatchObject({ body: { contentVersion: { status: "pending_scan" }, replayed: true }, status: 200 });
    expect(runtime.service.completeUpload).toHaveBeenCalledWith({ actor, operationId: ids.operation, reason: "file_http:confirm_upload", sessionId: ids.session, traceId });
    expect(JSON.stringify(response)).not.toMatch(/objectHandle|provider|etag|private\/object/u);
  });

  it("issues a fresh download grant on each audited operation replay without requiring CSRF", async () => {
    const runtime = fixture();
    runtime.service.authorizeDownload
      .mockResolvedValueOnce({ downloadUrl: "https://download.example.test/one?signature=one", expiresAt: "2026-07-28T01:02:00.000Z", fileReference, version: 1 })
      .mockResolvedValueOnce({ downloadUrl: "https://download.example.test/two?signature=two", expiresAt: "2026-07-28T01:03:00.000Z", fileReference, version: 1 });

    const withoutCsrf = context({ csrfToken: undefined, origin: undefined });
    const first = await runtime.adapter.authorizeDownload(withoutCsrf, downloadBody());
    const second = await runtime.adapter.authorizeDownload(withoutCsrf, downloadBody());

    expect(first.status).toBe(200);
    expect(first.body["downloadUrl"]).toContain("/one");
    expect(second.status).toBe(200);
    expect(second.body["downloadUrl"]).toContain("/two");
    expect(runtime.sessions.sessionForMutation).not.toHaveBeenCalled();
    expect(runtime.service.authorizeDownload).toHaveBeenCalledTimes(2);
    expect(runtime.service.authorizeDownload).toHaveBeenCalledWith({ actor, ...downloadBody(), operationId: ids.operation, reason: "file_http:authorize_download", traceId });
  });

  it("fails closed when actor resolution returns a system or malformed actor", async () => {
    const runtime = fixture();
    runtime.actorResolver.resolve.mockResolvedValueOnce({ actorId: "api", actorType: "system" });
    const denied = await runtime.adapter.authorizeDownload(context(), downloadBody());
    runtime.actorResolver.resolve.mockResolvedValueOnce({ actorId: "invalid actor", actorType: "authenticated_subject" });
    const invalid = await runtime.adapter.authorizeDownload(context(), downloadBody());

    expect(denied).toMatchObject({ body: { code: "file_center_denied" }, status: 403 });
    expect(invalid).toMatchObject({ body: { code: "file_center_invalid_input" }, status: 400 });
    expect(runtime.service.authorizeDownload).not.toHaveBeenCalled();
  });

  it.each([
    [new FileCenterError("file_center_denied"), 403, "file_center_denied"],
    [new FileCenterError("file_center_not_found"), 404, "file_center_not_found"],
    [new FileCenterError("file_center_not_ready"), 409, "file_center_not_ready"],
    [new FileCenterError("file_center_operation_conflict"), 409, "file_center_operation_conflict"],
    [new FileCenterError("file_center_policy_rejected"), 400, "file_center_policy_rejected"],
    [new FileCenterError("file_center_storage_unavailable"), 503, "file_center_storage_unavailable"],
  ])("stably maps a service failure", async (failure, status, code) => {
    const runtime = fixture();
    runtime.service.completeUpload.mockRejectedValueOnce(failure);

    await expect(runtime.adapter.confirmUpload(context(), ids.session)).resolves.toMatchObject({ body: { code }, status });
  });

  it("maps invalid sessions to 401 and opaque dependency failures to a safe 503", async () => {
    const invalidSession = fixture();
    invalidSession.sessions.sessionForMutation.mockRejectedValueOnce(new BrowserSessionFailure("authentication_session_invalid"));
    await expect(invalidSession.adapter.confirmUpload(context(), ids.session)).resolves.toMatchObject({ body: { code: "authentication_required" }, status: 401 });

    const unavailable = fixture();
    unavailable.actorResolver.resolve.mockRejectedValueOnce(new Error("provider secret payload"));
    const response = await unavailable.adapter.authorizeDownload(context({ idempotencyKey: randomUUID() }), downloadBody());
    expect(response).toEqual({ body: { code: "file_center_storage_unavailable" }, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }, status: 503 });
    expect(JSON.stringify(response)).not.toContain("provider secret payload");
  });

  it.each([
    [new AuthorizationDeniedError(randomUUID()), 403, "file_center_denied"],
    [Object.assign(new Error("association missing"), { code: "subject_not_associated" }), 403, "file_center_denied"],
    [new AuthorizationUnavailableError(), 503, "file_center_storage_unavailable"],
  ])("maps composition authorization failures without exposing details", async (failure, status, code) => {
    const runtime = fixture();
    runtime.actorResolver.resolve.mockRejectedValueOnce(failure);
    const response = await runtime.adapter.authorizeDownload(context(), downloadBody());
    expect(response).toMatchObject({ body: { code }, status });
    expect(JSON.stringify(response)).not.toContain(failure.message);
  });
});
