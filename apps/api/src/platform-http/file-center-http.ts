import { extractTraceContext } from "@ai-crm/observability";
import { AuthorizationDeniedError, AuthorizationUnavailableError } from "@ai-crm/platform-authorization";
import {
  FileCenterError,
  type ContentVersion,
  type FileActor,
  type FileCenterService,
  type FileReference,
  type ResourceReference,
  type UploadGrant,
  type UploadSession,
} from "@ai-crm/platform-file-center";

import { BrowserSessionFailure, type BrowserSessionFailureCode } from "../auth/errors.js";
import { parsePcSessionCredential } from "../auth/http-adapter.js";
import { validateBrowserMutation } from "../auth/session-security.js";
import type { BrowserMutationSession } from "../auth/session-service.js";

export interface FileCenterHttpResponse {
  readonly body: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly status: number;
}

export interface FileCenterHttpRequestContext {
  readonly cookie: string | undefined;
  readonly csrfToken?: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly origin?: string | undefined;
  readonly referer?: string | undefined;
  readonly selectedAssignmentId?: string | undefined;
  readonly traceparent?: string | undefined;
}

export interface FileCenterHttpActorResolver {
  resolve(input: {
    readonly credential: string;
    readonly operation: "download" | "upload";
    readonly selectedAssignmentId?: string;
    readonly traceId: string;
  }): Promise<Readonly<FileActor>>;
}

export interface FileCenterHttpAdapterOptions {
  readonly actorResolver: FileCenterHttpActorResolver;
  readonly allowedOrigins: readonly string[];
  readonly service: Pick<FileCenterService, "authorizeDownload" | "completeUpload" | "createUploadSession">;
  readonly sessions: {
    sessionForMutation(credential: string): Promise<Readonly<BrowserMutationSession>>;
  };
}

export interface FileCenterHttpAdapter {
  authorizeDownload(context: FileCenterHttpRequestContext, body: unknown): Promise<Readonly<FileCenterHttpResponse>>;
  confirmUpload(context: FileCenterHttpRequestContext, sessionId: unknown): Promise<Readonly<FileCenterHttpResponse>>;
  createUpload(context: FileCenterHttpRequestContext, body: unknown): Promise<Readonly<FileCenterHttpResponse>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MODULE_ID = /^[a-z][a-z0-9_.:-]{1,127}$/u;
const REFERENCE = /^[A-Za-z0-9_.:@/-]{1,255}$/u;
const MEDIA_TYPE = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u;
const ACTOR_ID = /^[A-Za-z0-9_.:@/-]{1,255}$/u;

const invalid = (): never => { throw new FileCenterError("file_center_invalid_input"); };

function exactObject(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) => descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.enumerable)) return invalid();
  const result = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
  const keys = Object.keys(result);
  if (required.some((key) => !Object.hasOwn(result, key)) || keys.some((key) => !required.includes(key) && !optional.includes(key))) return invalid();
  return result;
}

function uuid(value: unknown): string {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : invalid();
}

function boundedDisplay(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) return invalid();
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return invalid();
  }
  return value;
}

function identifier(value: unknown, pattern: RegExp): string {
  return typeof value === "string" && pattern.test(value) ? value : invalid();
}

function safeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : invalid();
}

function requiredCredential(cookie: string | undefined): string {
  const credential = parsePcSessionCredential(cookie);
  if (credential === undefined) throw new BrowserSessionFailure("authentication_session_invalid");
  return credential;
}

function actor(value: unknown): Readonly<FileActor> {
  const parsed = exactObject(value, ["actorId", "actorType"], ["assignmentId"]);
  if (parsed["actorType"] !== "authenticated_subject") throw new FileCenterError("file_center_denied");
  return Object.freeze({
    actorId: identifier(parsed["actorId"], ACTOR_ID),
    actorType: "authenticated_subject",
    ...(parsed["assignmentId"] === undefined ? {} : { assignmentId: uuid(parsed["assignmentId"]) }),
  });
}

function selectedAssignment(value: string | undefined): string | undefined {
  return value === undefined ? undefined : uuid(value);
}

function createUploadBody(value: unknown) {
  const parsed = exactObject(value, ["declaredMediaType", "declaredSizeBytes", "displayName", "ownerModule"], ["classificationReference"]);
  return Object.freeze({
    ...(parsed["classificationReference"] === undefined ? {} : { classificationReference: identifier(parsed["classificationReference"], REFERENCE) }),
    declaredMediaType: identifier(parsed["declaredMediaType"], MEDIA_TYPE).toLowerCase(),
    declaredSizeBytes: safeInteger(parsed["declaredSizeBytes"]),
    displayName: boundedDisplay(parsed["displayName"], 255),
    ownerModule: identifier(parsed["ownerModule"], MODULE_ID),
  });
}

function fileReference(value: unknown): Readonly<FileReference> {
  const parsed = exactObject(value, ["contentVersionId", "displayName", "fileId", "version"], ["mediaType", "sizeBytes"]);
  if (parsed["version"] !== 1) return invalid();
  return Object.freeze({
    contentVersionId: uuid(parsed["contentVersionId"]),
    displayName: boundedDisplay(parsed["displayName"], 255),
    fileId: uuid(parsed["fileId"]),
    ...(parsed["mediaType"] === undefined ? {} : { mediaType: identifier(parsed["mediaType"], MEDIA_TYPE).toLowerCase() }),
    ...(parsed["sizeBytes"] === undefined ? {} : { sizeBytes: safeInteger(parsed["sizeBytes"]) }),
    version: 1,
  });
}

function resourceReference(value: unknown): Readonly<ResourceReference> {
  const parsed = exactObject(value, ["resourceId", "resourceType"]);
  return Object.freeze({
    resourceId: identifier(parsed["resourceId"], REFERENCE),
    resourceType: identifier(parsed["resourceType"], MODULE_ID),
  });
}

function downloadBody(value: unknown): { readonly fileReference: Readonly<FileReference>; readonly resource: Readonly<ResourceReference> } {
  const parsed = exactObject(value, ["fileReference", "resource"]);
  return Object.freeze({ fileReference: fileReference(parsed["fileReference"]), resource: resourceReference(parsed["resource"]) });
}

function noStoreHeaders(): Readonly<Record<string, string>> {
  return Object.freeze({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
}

function publicUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || /\s/u.test(value)) throw new FileCenterError("file_center_storage_unavailable", { retryable: true });
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password) throw new Error("unsafe URL");
    return value;
  } catch {
    throw new FileCenterError("file_center_storage_unavailable", { retryable: true });
  }
}

function publicHeaders(value: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getPrototypeOf(value) !== Object.prototype || Object.keys(descriptors).length > 20 || Object.values(descriptors).some((item) => item.get !== undefined || item.set !== undefined || !item.enumerable)) {
    throw new FileCenterError("file_center_storage_unavailable", { retryable: true });
  }
  const result: Record<string, string> = {};
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (!/^[A-Za-z0-9-]{1,128}$/u.test(name) || typeof descriptor.value !== "string" || descriptor.value.length > 1024 || /[\r\n\0]/u.test(descriptor.value)) {
      throw new FileCenterError("file_center_storage_unavailable", { retryable: true });
    }
    result[name] = descriptor.value;
  }
  return Object.freeze(result);
}

function uploadGrant(value: UploadGrant): Readonly<Record<string, unknown>> {
  return Object.freeze({
    expiresAt: value.expiresAt,
    headers: publicHeaders(value.headers),
    method: "PUT",
    uploadUrl: publicUrl(value.uploadUrl),
    version: 1,
  });
}

function publicFileReference(value: FileReference): Readonly<Record<string, unknown>> {
  return Object.freeze({
    contentVersionId: value.contentVersionId,
    displayName: value.displayName,
    fileId: value.fileId,
    ...(value.mediaType === undefined ? {} : { mediaType: value.mediaType }),
    ...(value.sizeBytes === undefined ? {} : { sizeBytes: value.sizeBytes }),
    version: 1,
  });
}

function publicSession(value: UploadSession): Readonly<Record<string, unknown>> {
  return Object.freeze({
    contentVersionId: value.contentVersionId,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    fileId: value.fileId,
    sessionId: value.sessionId,
    status: value.status,
    version: 1,
  });
}

function publicContentVersion(value: ContentVersion): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...(value.actualSizeBytes === undefined ? {} : { actualSizeBytes: value.actualSizeBytes }),
    ...(value.checksumSha256 === undefined ? {} : { checksumSha256: value.checksumSha256 }),
    ...(value.completedAt === undefined ? {} : { completedAt: value.completedAt }),
    contentVersionId: value.contentVersionId,
    createdAt: value.createdAt,
    declaredMediaType: value.declaredMediaType,
    declaredSizeBytes: value.declaredSizeBytes,
    ...(value.detectedMediaType === undefined ? {} : { detectedMediaType: value.detectedMediaType }),
    fileId: value.fileId,
    ...(value.scannedAt === undefined ? {} : { scannedAt: value.scannedAt }),
    status: value.status,
    version: 1,
    versionNumber: value.versionNumber,
  });
}

const browserStatus: Readonly<Record<BrowserSessionFailureCode, number>> = Object.freeze({
  authentication_callback_invalid: 401,
  authentication_csrf_rejected: 403,
  authentication_dependency_unavailable: 503,
  authentication_refresh_in_progress: 503,
  authentication_refresh_rejected: 401,
  authentication_session_invalid: 401,
});

const fileStatus = Object.freeze({
  file_center_denied: 403,
  file_center_invalid_input: 400,
  file_center_not_found: 404,
  file_center_not_ready: 409,
  file_center_operation_conflict: 409,
  file_center_policy_rejected: 400,
  file_center_scan_unavailable: 503,
  file_center_storage_unavailable: 503,
} as const);

function errorResponse(error: unknown): Readonly<FileCenterHttpResponse> {
  const organizationDenied = typeof error === "object" && error !== null &&
    ["subject_not_associated", "employment_not_active", "assignment_not_active"].includes(String(Reflect.get(error, "code")));
  const code = error instanceof FileCenterError
    ? error.code
    : error instanceof AuthorizationDeniedError || organizationDenied
      ? "file_center_denied"
      : error instanceof AuthorizationUnavailableError
        ? "file_center_storage_unavailable"
    : error instanceof BrowserSessionFailure
      ? error.code === "authentication_session_invalid" || error.code === "authentication_refresh_rejected" ? "authentication_required" : error.code
      : "file_center_storage_unavailable";
  const status = error instanceof FileCenterError
    ? fileStatus[error.code]
    : error instanceof AuthorizationDeniedError || organizationDenied
      ? 403
      : error instanceof AuthorizationUnavailableError
        ? 503
    : error instanceof BrowserSessionFailure
      ? browserStatus[error.code]
      : 503;
  return Object.freeze({ body: Object.freeze({ code }), headers: noStoreHeaders(), status });
}

export function createFileCenterHttpAdapter(options: FileCenterHttpAdapterOptions): Readonly<FileCenterHttpAdapter> {
  async function resolveActor(context: FileCenterHttpRequestContext, operation: "download" | "upload", credential: string, traceId: string): Promise<Readonly<FileActor>> {
    const assignmentId = selectedAssignment(context.selectedAssignmentId);
    return actor(await options.actorResolver.resolve({ credential, operation, ...(assignmentId === undefined ? {} : { selectedAssignmentId: assignmentId }), traceId }));
  }

  async function secureMutation(context: FileCenterHttpRequestContext): Promise<{ readonly actor: Readonly<FileActor>; readonly operationId: string; readonly traceId: string }> {
    const operationId = uuid(context.idempotencyKey);
    const credential = requiredCredential(context.cookie);
    const session = await options.sessions.sessionForMutation(credential);
    validateBrowserMutation({
      allowedOrigins: options.allowedOrigins,
      csrfHeader: context.csrfToken,
      csrfSessionValue: session.csrfToken,
      origin: context.origin,
      referer: context.referer,
    });
    const traceId = extractTraceContext({ traceparent: context.traceparent }).traceId;
    const resolvedActor = await resolveActor(context, "upload", credential, traceId);
    return Object.freeze({ actor: resolvedActor, operationId, traceId });
  }

  return Object.freeze({
    async createUpload(context: FileCenterHttpRequestContext, body: unknown): Promise<Readonly<FileCenterHttpResponse>> {
      try {
        const input = createUploadBody(body);
        const metadata = await secureMutation(context);
        const result = await options.service.createUploadSession({ ...input, ...metadata, reason: "file_http:create_upload" });
        return Object.freeze({
          body: Object.freeze({ fileReference: publicFileReference(result.fileReference), replayed: result.replayed, session: publicSession(result.session), uploadGrant: uploadGrant(result.uploadGrant) }),
          headers: noStoreHeaders(),
          status: 201,
        });
      } catch (error) { return errorResponse(error); }
    },

    async confirmUpload(context: FileCenterHttpRequestContext, sessionId: unknown): Promise<Readonly<FileCenterHttpResponse>> {
      try {
        const parsedSessionId = uuid(sessionId);
        const metadata = await secureMutation(context);
        const result = await options.service.completeUpload({ ...metadata, reason: "file_http:confirm_upload", sessionId: parsedSessionId });
        return Object.freeze({ body: Object.freeze({ contentVersion: publicContentVersion(result.contentVersion), replayed: result.replayed }), headers: noStoreHeaders(), status: 200 });
      } catch (error) { return errorResponse(error); }
    },

    async authorizeDownload(context: FileCenterHttpRequestContext, body: unknown): Promise<Readonly<FileCenterHttpResponse>> {
      try {
        const input = downloadBody(body);
        const operationId = uuid(context.idempotencyKey);
        const credential = requiredCredential(context.cookie);
        const traceId = extractTraceContext({ traceparent: context.traceparent }).traceId;
        const resolvedActor = await resolveActor(context, "download", credential, traceId);
        const result = await options.service.authorizeDownload({ ...input, actor: resolvedActor, operationId, reason: "file_http:authorize_download", traceId });
        return Object.freeze({
          body: Object.freeze({ downloadUrl: publicUrl(result.downloadUrl), expiresAt: result.expiresAt, fileReference: publicFileReference(result.fileReference), version: 1 }),
          headers: noStoreHeaders(),
          status: 200,
        });
      } catch (error) { return errorResponse(error); }
    },
  });
}
