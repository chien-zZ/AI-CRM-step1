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

function queryContext(value: RegistryQueryContext): RegistryQueryContext {
  const actor = validateActor(value.actor);
  if (actor.actorType !== "authenticated_subject" ||
    actor.workforcePersonId === undefined ||
    !TRACE.test(value.traceId) ||
    !UUID.test(value.subject.workforcePersonId)) invalid();
  const rawAssignmentIds: unknown = value.subject.activeAssignmentIds;
  if (!Array.isArray(rawAssignmentIds) || rawAssignmentIds.length > 128) invalid();
  const activeAssignmentIds = rawAssignmentIds.map((id: unknown): string => {
    if (typeof id !== "string" || !UUID.test(id)) invalid();
    return id.toLowerCase();
  });
  if (new Set(activeAssignmentIds).size !== activeAssignmentIds.length) invalid();
  const selectedAssignmentId = value.subject.selectedAssignmentId === undefined
    ? undefined
    : UUID.test(value.subject.selectedAssignmentId) ? value.subject.selectedAssignmentId.toLowerCase() : invalid();
  if (selectedAssignmentId !== undefined && !activeAssignmentIds.includes(selectedAssignmentId)) invalid();
  if (actor.workforcePersonId !== value.subject.workforcePersonId.toLowerCase() ||
    actor.assignmentId !== selectedAssignmentId) invalid();
  return Object.freeze({
    actor: Object.freeze(actor),
    subject: Object.freeze({
      activeAssignmentIds: Object.freeze([...activeAssignmentIds].sort()),
      ...(selectedAssignmentId === undefined ? {} : { selectedAssignmentId }),
      workforcePersonId: value.subject.workforcePersonId.toLowerCase(),
    }),
    traceId: value.traceId.toLowerCase(),
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
    return createApplicationRegistryService(store, {
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
  };
  return Object.freeze({
    async loadRegistry(input: { readonly audience: RegistryAudience; readonly context: RegistryQueryContext }) {
      return invoke(input.context).loadRegistry({ actor: input.context.actor, audience: input.audience });
    },
    async resolveDeepLink(input: { readonly audience: RegistryAudience; readonly context: RegistryQueryContext; readonly link: RegisteredDeepLink }) {
      return invoke(input.context).resolveDeepLink({ actor: input.context.actor, audience: input.audience, link: input.link });
    },
  });
}
