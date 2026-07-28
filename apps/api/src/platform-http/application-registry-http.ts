import {
  AppRegistryError,
  type ApplicationRegistryQueryService,
  type RegisteredDeepLink,
  type RegistryActor,
  type RegistryQueryContext,
} from "@ai-crm/platform-app-registry";

export interface AuthenticatedApplicationRegistryHttpContext {
  readonly activeAssignmentIds: readonly string[];
  readonly actorId: string;
  readonly assignmentId?: string;
  readonly traceId: string;
  readonly workforcePersonId: string;
}

export interface ApplicationRegistryHttpResponse {
  readonly body?: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly status: number;
}

export interface ApplicationRegistryHttpAdapter {
  loadRegistry(context: unknown): Promise<Readonly<ApplicationRegistryHttpResponse>>;
  resolveDeepLink(context: unknown, body: unknown): Promise<Readonly<ApplicationRegistryHttpResponse>>;
}

const ID = /^[a-z][a-z0-9_.-]{0,127}$/u;
const REFERENCE = /^[A-Za-z0-9_.:-]{1,255}$/u;
const TRACE_ID = /^(?!0{32})[0-9a-f]{32}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

class InvalidAuthenticatedContext extends Error {}

function object(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) =>
    descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.enumerable)) return undefined;
  return Object.fromEntries(
    Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value as unknown]),
  );
}

function exactObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> | undefined {
  const candidate = object(value);
  if (candidate === undefined) return undefined;
  const keys = Object.keys(candidate);
  return required.every((key) => Object.hasOwn(candidate, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
    ? candidate
    : undefined;
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

function authenticatedMetadata(value: unknown): RegistryQueryContext {
  const context = exactObject(
    value,
    ["activeAssignmentIds", "actorId", "traceId", "workforcePersonId"],
    ["assignmentId"],
  );
  const activeAssignmentIds = context === undefined ? undefined : assignmentIds(context.activeAssignmentIds);
  if (context === undefined ||
    typeof context.actorId !== "string" || !REFERENCE.test(context.actorId) ||
    typeof context.workforcePersonId !== "string" || !UUID.test(context.workforcePersonId) ||
    typeof context.traceId !== "string" || !TRACE_ID.test(context.traceId) ||
    activeAssignmentIds === undefined ||
    (context.assignmentId !== undefined &&
      (typeof context.assignmentId !== "string" || !UUID.test(context.assignmentId)))) {
    throw new InvalidAuthenticatedContext();
  }
  const assignmentId = context.assignmentId === undefined ? undefined : context.assignmentId.toLowerCase();
  if (assignmentId !== undefined && !activeAssignmentIds.includes(assignmentId)) throw new InvalidAuthenticatedContext();
  const actor: RegistryActor = Object.freeze({
    actorId: context.actorId,
    actorType: "authenticated_subject",
    ...(assignmentId === undefined ? {} : { assignmentId }),
    workforcePersonId: context.workforcePersonId.toLowerCase(),
  });
  return {
    actor,
    subject: Object.freeze({
      activeAssignmentIds,
      ...(assignmentId === undefined ? {} : { selectedAssignmentId: assignmentId }),
      workforcePersonId: context.workforcePersonId.toLowerCase(),
    }),
    traceId: context.traceId,
  };
}

function deepLink(value: unknown): RegisteredDeepLink | undefined {
  const candidate = exactObject(
    value,
    ["applicationId", "resourceReference", "routeId", "source", "version"],
  );
  if (candidate === undefined ||
    typeof candidate.applicationId !== "string" || !ID.test(candidate.applicationId) ||
    typeof candidate.resourceReference !== "string" || !REFERENCE.test(candidate.resourceReference) ||
    typeof candidate.routeId !== "string" || !ID.test(candidate.routeId) ||
    (candidate.source !== "notification" && candidate.source !== "task") ||
    candidate.version !== 1) return undefined;
  return Object.freeze({
    applicationId: candidate.applicationId,
    resourceReference: candidate.resourceReference,
    routeId: candidate.routeId,
    source: candidate.source,
    version: 1,
  });
}

function headers(traceId?: string): Readonly<Record<string, string>> {
  return Object.freeze({
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'",
    ...(traceId === undefined ? {} : { "X-Trace-Id": traceId }),
  });
}

function errorResponse(error: unknown, traceId?: string): Readonly<ApplicationRegistryHttpResponse> {
  if (error instanceof InvalidAuthenticatedContext) {
    return Object.freeze({
      body: Object.freeze({ code: "app_registry_unauthorized", message: "Authentication is required." }),
      headers: headers(),
      status: 401,
    });
  }
  const code = error instanceof AppRegistryError ? error.code : "app_registry_unavailable";
  const mapping = {
    app_registry_denied: { message: "Access to the application registry was denied.", status: 403 },
    app_registry_invalid_input: { message: "The application registry request is invalid.", status: 400 },
    app_registry_operation_conflict: { message: "The application registry request conflicts with current state.", status: 409 },
    app_registry_target_unavailable: { message: "The application registry target is unavailable.", status: 404 },
    app_registry_unavailable: { message: "The application registry is temporarily unavailable.", status: 503 },
  } as const;
  const response = mapping[code];
  return Object.freeze({
    body: Object.freeze({ code, message: response.message }),
    headers: headers(traceId),
    status: response.status,
  });
}

export function createApplicationRegistryHttpAdapter(
  service: ApplicationRegistryQueryService,
): Readonly<ApplicationRegistryHttpAdapter> {
  return Object.freeze({
    async loadRegistry(context: unknown): Promise<Readonly<ApplicationRegistryHttpResponse>> {
      let traceId: string | undefined;
      try {
        const metadata = authenticatedMetadata(context);
        traceId = metadata.traceId;
        const snapshot = await service.loadRegistry({ audience: "internal", context: metadata });
        return Object.freeze({
          body: snapshot as unknown as Readonly<Record<string, unknown>>,
          headers: headers(traceId),
          status: 200,
        });
      } catch (error) {
        return errorResponse(error, traceId);
      }
    },

    async resolveDeepLink(context: unknown, body: unknown): Promise<Readonly<ApplicationRegistryHttpResponse>> {
      let traceId: string | undefined;
      try {
        const metadata = authenticatedMetadata(context);
        traceId = metadata.traceId;
        const link = deepLink(body);
        if (link === undefined) throw new AppRegistryError("app_registry_invalid_input");
        const resolved = await service.resolveDeepLink({
          audience: "internal",
          context: metadata,
          link,
        });
        return Object.freeze({
          body: resolved as unknown as Readonly<Record<string, unknown>>,
          headers: headers(traceId),
          status: 200,
        });
      } catch (error) {
        return errorResponse(error, traceId);
      }
    },
  });
}
