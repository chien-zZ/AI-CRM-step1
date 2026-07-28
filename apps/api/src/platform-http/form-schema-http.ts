import { AuthorizationDeniedError, AuthorizationUnavailableError, type PermissionRequest } from "@ai-crm/platform-authorization";
import { FormSchemaError, type FormActor, type FormQueryContext, type FormSchemaQueryService } from "@ai-crm/platform-form-schema";

import { BrowserSessionFailure } from "../auth/errors.js";

const MAX_BODY_BYTES = 262_144;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 10_000;
const TRACE_ID = /^(?!0{32})[0-9a-f]{32}$/u;
const ACTOR_ID = /^[A-Za-z0-9_.:-]{1,255}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RELEASE_PATH = /^\/form-definitions\/([a-z][a-z0-9_.-]{0,127})\/releases\/([1-9][0-9]*)(\/validate)?$/u;
const JSON_MEDIA_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/iu;

export interface FormSchemaHttpRequest {
  readonly at: string;
  readonly body?: string | Uint8Array;
  readonly contentType?: string;
  readonly credential?: string;
  readonly method: string;
  readonly path: string;
  readonly selectedAssignmentId?: string;
  readonly traceparent?: string;
}

export interface FormSchemaHttpResponse {
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
  readonly status: number;
}

export interface FormSchemaHttpAdapter {
  handle(request: FormSchemaHttpRequest): Promise<Readonly<FormSchemaHttpResponse>>;
}

export interface FormSchemaHttpAdapterOptions {
  readonly authorize: (input: FormSchemaHttpAuthorizationInput) => Promise<Readonly<FormSchemaHttpAuthorizedContext>>;
  readonly service: FormSchemaQueryService;
}

export interface FormSchemaHttpAuthorizationInput {
  readonly at: string;
  readonly credential: string;
  readonly permission: PermissionRequest;
  readonly selectedAssignmentId?: string;
  readonly traceparent?: string;
}

/** Trusted output of the BFF session, organization, and static HTTP-permission chain. */
export interface FormSchemaHttpAuthorizedContext {
  readonly activeAssignmentIds: readonly string[];
  readonly actorId: string;
  readonly assignmentId?: string;
  readonly traceId: string;
  readonly workforcePersonId: string;
}

interface Route {
  readonly definitionId: string;
  readonly operation: "read" | "validate";
  readonly releaseVersion: number;
}

interface TransportFailure {
  readonly code: string;
  readonly message: string;
  readonly status: number;
}

class TransportBoundaryError extends Error {
  constructor(readonly failure: TransportFailure) {
    super(failure.code);
    this.name = "TransportBoundaryError";
  }
}

const failures = Object.freeze({
  badRequest: { code: "form_request_invalid", message: "The form request is malformed.", status: 400 },
  forbidden: { code: "form_forbidden", message: "Access to the form release is denied.", status: 403 },
  method: { code: "form_method_not_allowed", message: "The method is not allowed for this form route.", status: 405 },
  notFound: { code: "form_not_found", message: "The exact form release does not exist.", status: 404 },
  payload: { code: "form_payload_too_large", message: "The form validation payload exceeds the bounded transport contract.", status: 413 },
  schema: { code: "form_schema_rejected", message: "The registered form release cannot be compiled.", status: 422 },
  unauthorized: { code: "form_unauthorized", message: "A valid internal session is required.", status: 401 },
  unavailable: { code: "form_unavailable", message: "Form validation is temporarily unavailable.", status: 503 },
} satisfies Readonly<Record<string, TransportFailure>>);

function response(failure: TransportFailure, traceId?: string, additional: Readonly<Record<string, string>> = {}): Readonly<FormSchemaHttpResponse> {
  return Object.freeze({
    body: Object.freeze({ code: failure.code, message: failure.message }),
    headers: Object.freeze({ "Cache-Control": "no-store", ...(traceId === undefined ? {} : { "X-Trace-Id": traceId }), ...additional }),
    status: failure.status,
  });
}

function success(body: unknown, traceId: string): Readonly<FormSchemaHttpResponse> {
  return Object.freeze({ body, headers: Object.freeze({ "Cache-Control": "no-store", "Content-Type": "application/json", "X-Trace-Id": traceId }), status: 200 });
}

function route(path: string): Route | undefined {
  if (path.length > 512 || path.includes("?") || path.includes("#") || path.includes("%")) return undefined;
  const match = RELEASE_PATH.exec(path);
  if (match === null) return undefined;
  const releaseVersion = Number(match[2]);
  if (!Number.isSafeInteger(releaseVersion)) return undefined;
  return { definitionId: match[1] as string, operation: match[3] === undefined ? "read" : "validate", releaseVersion };
}

function bytes(body: string | Uint8Array | undefined): Uint8Array {
  if (body === undefined) throw new TransportBoundaryError(failures.badRequest);
  const encoded = typeof body === "string" ? new TextEncoder().encode(body) : body;
  if (encoded.byteLength > MAX_BODY_BYTES) throw new TransportBoundaryError(failures.payload);
  return encoded;
}

function boundedData(value: unknown): void {
  const pending: Array<{ readonly depth: number; readonly value: unknown }> = [{ depth: 1, value }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop() as { readonly depth: number; readonly value: unknown };
    nodes += 1;
    if (nodes > MAX_JSON_NODES || current.depth > MAX_JSON_DEPTH) throw new TransportBoundaryError(failures.payload);
    if (Array.isArray(current.value)) {
      for (const child of current.value) pending.push({ depth: current.depth + (typeof child === "object" && child !== null ? 1 : 0), value: child });
    } else if (typeof current.value === "object" && current.value !== null) {
      for (const child of Object.values(current.value as Record<string, unknown>)) pending.push({ depth: current.depth + (typeof child === "object" && child !== null ? 1 : 0), value: child });
    }
  }
}

function validationData(request: FormSchemaHttpRequest): unknown {
  if (request.contentType === undefined || !JSON_MEDIA_TYPE.test(request.contentType)) throw new TransportBoundaryError(failures.badRequest);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes(request.body)));
  } catch (error) {
    if (error instanceof TransportBoundaryError) throw error;
    throw new TransportBoundaryError(failures.badRequest);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TransportBoundaryError(failures.badRequest);
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "data") throw new TransportBoundaryError(failures.badRequest);
  const data = (value as Record<string, unknown>).data;
  boundedData(data);
  return data;
}

function assignmentIds(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > 128) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined ||
      !descriptor.enumerable || typeof descriptor.value !== "string" || !UUID.test(descriptor.value)) return undefined;
    result.push(descriptor.value.toLowerCase());
  }
  if (Object.keys(descriptors).some((key) => key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key)) ||
    new Set(result).size !== result.length) return undefined;
  return Object.freeze(result.sort());
}

function queryContext(value: unknown): FormQueryContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("form_http_authorized_context_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const required = ["activeAssignmentIds", "actorId", "traceId", "workforcePersonId"];
  const optional = ["assignmentId"];
  const keys = Object.keys(descriptors);
  if (Object.values(descriptors).some((descriptor) => descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.enumerable) ||
      required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => !required.includes(key) && !optional.includes(key))) throw new Error("form_http_authorized_context_invalid");
  const context = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value])) as Record<string, unknown>;
  const activeAssignmentIds = assignmentIds(context.activeAssignmentIds);
  if (typeof context.actorId !== "string" || !ACTOR_ID.test(context.actorId) ||
      typeof context.workforcePersonId !== "string" || !UUID.test(context.workforcePersonId) ||
      typeof context.traceId !== "string" || !TRACE_ID.test(context.traceId) ||
      activeAssignmentIds === undefined ||
      (context.assignmentId !== undefined && (typeof context.assignmentId !== "string" || !UUID.test(context.assignmentId)))) {
    throw new Error("form_http_authorized_context_invalid");
  }
  const assignmentId = context.assignmentId === undefined ? undefined : context.assignmentId.toLowerCase();
  if (assignmentId !== undefined && !activeAssignmentIds.includes(assignmentId)) throw new Error("form_http_authorized_context_invalid");
  const moduleActor: FormActor = Object.freeze({
    actorId: context.actorId,
    actorType: "authenticated_subject",
    ...(assignmentId === undefined ? {} : { assignmentId }),
  });
  return Object.freeze({
    actor: moduleActor,
    subject: Object.freeze({
      activeAssignmentIds,
      ...(assignmentId === undefined ? {} : { selectedAssignmentId: assignmentId }),
      workforcePersonId: context.workforcePersonId.toLowerCase(),
    }),
    traceId: context.traceId,
  });
}

function permission(operation: Route["operation"]): PermissionRequest {
  return Object.freeze({ action: operation, resource: "platform.form-schema.form-release" });
}

function mapped(error: unknown): TransportFailure {
  if (error instanceof BrowserSessionFailure) {
    return error.code === "authentication_dependency_unavailable" ? failures.unavailable : failures.unauthorized;
  }
  if (error instanceof AuthorizationDeniedError) return failures.forbidden;
  if (error instanceof AuthorizationUnavailableError) return failures.unavailable;
  if (error instanceof FormSchemaError) {
    switch (error.code) {
      case "form_denied": return failures.forbidden;
      case "form_invalid_input": return failures.badRequest;
      case "form_not_found": return failures.notFound;
      case "form_schema_rejected": return failures.schema;
      case "form_operation_conflict":
      case "form_unavailable": return failures.unavailable;
    }
  }
  if (typeof error === "object" && error !== null) {
    const code: unknown = Reflect.get(error, "code");
    if (code === "subject_not_associated" || code === "employment_not_active" || code === "assignment_not_active") return failures.forbidden;
  }
  return failures.unavailable;
}

export function createFormSchemaHttpAdapter(options: FormSchemaHttpAdapterOptions): Readonly<FormSchemaHttpAdapter> {
  return Object.freeze({
    async handle(request: FormSchemaHttpRequest): Promise<Readonly<FormSchemaHttpResponse>> {
      const parsedRoute = route(request.path);
      if (parsedRoute === undefined) return response(failures.notFound);
      const requiredMethod = parsedRoute.operation === "read" ? "GET" : "POST";
      if (request.method !== requiredMethod) return response(failures.method, undefined, { Allow: requiredMethod });
      let data: unknown;
      try {
        if (parsedRoute.operation === "validate") data = validationData(request);
        else if (request.body !== undefined) throw new TransportBoundaryError(failures.badRequest);
      } catch (error) {
        const failure = error instanceof TransportBoundaryError ? error.failure : failures.badRequest;
        return response(failure);
      }

      if (request.credential === undefined || request.credential.length === 0) return response(failures.unauthorized);
      let traceId: string | undefined;
      try {
        const context = await options.authorize({
          at: request.at,
          credential: request.credential,
          permission: permission(parsedRoute.operation),
          ...(request.selectedAssignmentId === undefined ? {} : { selectedAssignmentId: request.selectedAssignmentId }),
          ...(request.traceparent === undefined ? {} : { traceparent: request.traceparent }),
        });
        const moduleContext = queryContext(context);
        traceId = context.traceId;
        const result = parsedRoute.operation === "read"
          ? await options.service.getRelease({ context: moduleContext, definitionId: parsedRoute.definitionId, releaseVersion: parsedRoute.releaseVersion })
          : await options.service.validateSubmission({ context: moduleContext, data, definitionId: parsedRoute.definitionId, releaseVersion: parsedRoute.releaseVersion });
        return success(result, traceId);
      } catch (error) {
        return response(mapped(error), traceId);
      }
    },
  });
}
