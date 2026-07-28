import { AppRegistryError } from "./errors.js";
import { createPostgresApplicationRegistryStore } from "./postgres-store.js";
import { createApplicationRegistryService } from "./service.js";
import type { AppRegistryPersistenceRuntime } from "./store.js";
import type {
  ApplicationRegistryQueryService,
  RegisteredDeepLink,
  RegistryAudience,
  RegistryPermissionReference,
  RegistryQueryAuthorizer,
  RegistryQueryContext,
} from "./types.js";
import { validateActor, validateAuthorizationDecision } from "./validation.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TRACE = /^(?!0{32})[0-9a-f]{32}$/u;

function invalid(): never {
  throw new AppRegistryError("app_registry_invalid_input");
}

function exactObject(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) =>
    descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.enumerable)) invalid();
  const keys = Object.keys(descriptors);
  if (required.some((key) => !Object.hasOwn(descriptors, key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))) invalid();
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function exactArray(value: unknown, maximumLength: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximumLength) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const items: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.enumerable) invalid();
    items.push(descriptor.value);
  }
  if (Object.keys(descriptors).some((key) => key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key))) invalid();
  return items;
}

function queryContext(value: RegistryQueryContext): RegistryQueryContext {
  const raw = exactObject(value, ["actor", "subject", "traceId"]);
  const subject = exactObject(raw.subject, ["activeAssignmentIds", "workforcePersonId"], ["selectedAssignmentId"]);
  const actor = validateActor(exactObject(raw.actor, ["actorId", "actorType"], ["assignmentId", "workforcePersonId"]));
  if (actor.actorType !== "authenticated_subject" ||
    actor.workforcePersonId === undefined ||
    typeof raw.traceId !== "string" || !TRACE.test(raw.traceId) ||
    typeof subject.workforcePersonId !== "string" || !UUID.test(subject.workforcePersonId)) invalid();
  const activeAssignmentIds = exactArray(subject.activeAssignmentIds, 128).map((id: unknown): string => {
    if (typeof id !== "string" || !UUID.test(id)) invalid();
    return id.toLowerCase();
  });
  if (new Set(activeAssignmentIds).size !== activeAssignmentIds.length) invalid();
  const selectedAssignmentId = subject.selectedAssignmentId === undefined
    ? undefined
    : typeof subject.selectedAssignmentId === "string" && UUID.test(subject.selectedAssignmentId)
      ? subject.selectedAssignmentId.toLowerCase()
      : invalid();
  if (selectedAssignmentId !== undefined && !activeAssignmentIds.includes(selectedAssignmentId)) invalid();
  if (actor.workforcePersonId !== subject.workforcePersonId.toLowerCase() ||
    actor.assignmentId !== selectedAssignmentId) invalid();
  return Object.freeze({
    actor: Object.freeze(actor),
    subject: Object.freeze({
      activeAssignmentIds: Object.freeze([...activeAssignmentIds].sort()),
      ...(selectedAssignmentId === undefined ? {} : { selectedAssignmentId }),
      workforcePersonId: subject.workforcePersonId.toLowerCase(),
    }),
    traceId: raw.traceId.toLowerCase(),
  });
}

function permission(code: string): RegistryPermissionReference {
  const separator = code.lastIndexOf(":");
  if (separator < 1 || separator === code.length - 1) invalid();
  return Object.freeze({ action: code.slice(separator + 1), code, resource: code.slice(0, separator) });
}

export function createPostgresApplicationRegistryQueryService(
  runtime: AppRegistryPersistenceRuntime,
  authorizer: RegistryQueryAuthorizer,
): ApplicationRegistryQueryService {
  const store = createPostgresApplicationRegistryStore(runtime);
  const invoke = (rawContext: RegistryQueryContext) => {
    const context = queryContext(rawContext);
    const service = createApplicationRegistryService(store, {
      async authorize(request) {
        if (request.permissionCode === undefined) invalid();
        try {
          return validateAuthorizationDecision(await authorizer.authorize({
            actor: context.actor,
            permission: permission(request.permissionCode),
            resourceId: request.resourceId,
            resourceType: request.resourceType,
            subject: context.subject,
            traceId: context.traceId,
          }));
        } catch (error) {
          if (error instanceof AppRegistryError) throw error;
          throw new AppRegistryError("app_registry_unavailable", { cause: error, retryable: true });
        }
      },
    }, {
      record: () => Promise.reject(new Error("app_registry_query_audit_not_applicable")),
    });
    return Object.freeze({ context, service });
  };
  return Object.freeze({
    async loadRegistry(input: { readonly audience: RegistryAudience; readonly context: RegistryQueryContext }) {
      const raw = exactObject(input, ["audience", "context"]);
      if (raw.audience !== "internal" && raw.audience !== "external") invalid();
      const request = invoke(raw.context as RegistryQueryContext);
      return request.service.loadRegistry({ actor: request.context.actor, audience: raw.audience });
    },
    async resolveDeepLink(input: { readonly audience: RegistryAudience; readonly context: RegistryQueryContext; readonly link: RegisteredDeepLink }) {
      const raw = exactObject(input, ["audience", "context", "link"]);
      if (raw.audience !== "internal" && raw.audience !== "external") invalid();
      const request = invoke(raw.context as RegistryQueryContext);
      const link = exactObject(raw.link, ["applicationId", "resourceReference", "routeId", "source", "version"]);
      return request.service.resolveDeepLink({ actor: request.context.actor, audience: raw.audience, link: link as unknown as RegisteredDeepLink });
    },
  });
}
