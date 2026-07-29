import { FormSchemaError } from "./errors.js";
import { createPostgresFormSchemaStore } from "./postgres-store.js";
import type { FormPersistenceRuntime } from "./store.js";
import type {
  FormQueryAuthorizer,
  FormQueryContext,
  FormSchemaQueryService,
  FormValidationResult,
} from "./types.js";
import { actor, compileSchema, decision, identifier, positiveVersion, safeErrors, trace, uuid } from "./validation.js";

function invalid(): never {
  throw new FormSchemaError("form_invalid_input");
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

function queryContext(value: FormQueryContext): FormQueryContext {
  const raw = exactObject(value, ["actor", "subject", "traceId"]);
  const subject = exactObject(raw.subject, ["activeAssignmentIds", "workforcePersonId"], ["selectedAssignmentId"]);
  const normalizedActor = actor(exactObject(raw.actor, ["actorId", "actorType"], ["assignmentId"]));
  if (normalizedActor.actorType !== "authenticated_subject" ||
    !Array.isArray(subject.activeAssignmentIds)) invalid();
  const activeAssignmentIds = exactArray(subject.activeAssignmentIds, 128).map(uuid);
  if (new Set(activeAssignmentIds).size !== activeAssignmentIds.length) invalid();
  const selectedAssignmentId = subject.selectedAssignmentId === undefined
    ? undefined
    : uuid(subject.selectedAssignmentId);
  if (selectedAssignmentId !== undefined && !activeAssignmentIds.includes(selectedAssignmentId)) invalid();
  if (normalizedActor.assignmentId !== selectedAssignmentId) invalid();
  return Object.freeze({
    actor: Object.freeze(normalizedActor),
    subject: Object.freeze({
      activeAssignmentIds: Object.freeze([...activeAssignmentIds].sort()),
      ...(selectedAssignmentId === undefined ? {} : { selectedAssignmentId }),
      workforcePersonId: uuid(subject.workforcePersonId),
    }),
    traceId: trace(raw.traceId),
  });
}

const permission = (action: "read" | "validate") => Object.freeze({
  action,
  code: `platform.form-schema.form-release:${action}`,
  resource: "platform.form-schema.form-release" as const,
});

export function createPostgresFormSchemaQueryService(
  runtime: FormPersistenceRuntime,
  authorizer: FormQueryAuthorizer,
): FormSchemaQueryService {
  const store = createPostgresFormSchemaStore(runtime);
  const authorize = async (
    context: FormQueryContext,
    action: "read" | "validate",
    definitionId: string,
    releaseVersion: number,
  ): Promise<void> => {
    try {
      const result = decision(await authorizer.authorize({
        action,
        actor: context.actor,
        definitionId,
        permission: permission(action),
        releaseVersion,
        subject: context.subject,
        traceId: context.traceId,
      }));
      if (!result.allowed) throw new FormSchemaError("form_denied");
    } catch (error) {
      if (error instanceof FormSchemaError) throw error;
      throw new FormSchemaError("form_unavailable", { cause: error, retryable: true });
    }
  };
  const find = async (definitionId: string, releaseVersion: number) => {
    try {
      return await store.findRelease(definitionId, releaseVersion);
    } catch (error) {
      if (error instanceof FormSchemaError) throw error;
      throw new FormSchemaError("form_unavailable", { cause: error, retryable: true });
    }
  };
  return Object.freeze({
    async getRelease(input: Parameters<FormSchemaQueryService["getRelease"]>[0]) {
      const raw = exactObject(input, ["context", "definitionId", "releaseVersion"]);
      const context = queryContext(raw.context as FormQueryContext);
      const definitionId = identifier(raw.definitionId);
      const releaseVersion = positiveVersion(raw.releaseVersion);
      await authorize(context, "read", definitionId, releaseVersion);
      const release = await find(definitionId, releaseVersion);
      if (release === undefined) throw new FormSchemaError("form_not_found");
      return release;
    },
    async validateSubmission(input: Parameters<FormSchemaQueryService["validateSubmission"]>[0]): Promise<FormValidationResult> {
      const raw = exactObject(input, ["context", "data", "definitionId", "releaseVersion"]);
      const context = queryContext(raw.context as FormQueryContext);
      const definitionId = identifier(raw.definitionId);
      const releaseVersion = positiveVersion(raw.releaseVersion);
      await authorize(context, "validate", definitionId, releaseVersion);
      const release = await find(definitionId, releaseVersion);
      if (release === undefined || !release.active) throw new FormSchemaError("form_not_found");
      const validate = compileSchema(release.jsonSchema);
      const valid = validate(raw.data);
      return {
        errors: safeErrors(validate.errors),
        reference: { contentDigest: release.contentDigest, definitionId: release.definitionId, releaseVersion: release.releaseVersion, version: 1 },
        valid,
      };
    },
  });
}
