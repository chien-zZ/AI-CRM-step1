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

function queryContext(value: FormQueryContext): FormQueryContext {
  const normalizedActor = actor(value.actor);
  if (normalizedActor.actorType !== "authenticated_subject" ||
    !Array.isArray(value.subject.activeAssignmentIds) ||
    value.subject.activeAssignmentIds.length > 128) invalid();
  const activeAssignmentIds = value.subject.activeAssignmentIds.map(uuid);
  if (new Set(activeAssignmentIds).size !== activeAssignmentIds.length) invalid();
  const selectedAssignmentId = value.subject.selectedAssignmentId === undefined
    ? undefined
    : uuid(value.subject.selectedAssignmentId);
  if (selectedAssignmentId !== undefined && !activeAssignmentIds.includes(selectedAssignmentId)) invalid();
  if (normalizedActor.assignmentId !== selectedAssignmentId) invalid();
  return Object.freeze({
    actor: Object.freeze(normalizedActor),
    subject: Object.freeze({
      activeAssignmentIds: Object.freeze([...activeAssignmentIds].sort()),
      ...(selectedAssignmentId === undefined ? {} : { selectedAssignmentId }),
      workforcePersonId: uuid(value.subject.workforcePersonId),
    }),
    traceId: trace(value.traceId),
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
      const context = queryContext(input.context);
      const definitionId = identifier(input.definitionId);
      const releaseVersion = positiveVersion(input.releaseVersion);
      await authorize(context, "read", definitionId, releaseVersion);
      const release = await find(definitionId, releaseVersion);
      if (release === undefined) throw new FormSchemaError("form_not_found");
      return release;
    },
    async validateSubmission(input: Parameters<FormSchemaQueryService["validateSubmission"]>[0]): Promise<FormValidationResult> {
      const context = queryContext(input.context);
      const definitionId = identifier(input.definitionId);
      const releaseVersion = positiveVersion(input.releaseVersion);
      await authorize(context, "validate", definitionId, releaseVersion);
      const release = await find(definitionId, releaseVersion);
      if (release === undefined) throw new FormSchemaError("form_not_found");
      const validate = compileSchema(release.jsonSchema);
      const valid = validate(input.data);
      return {
        errors: safeErrors(validate.errors),
        reference: { contentDigest: release.contentDigest, definitionId: release.definitionId, releaseVersion: release.releaseVersion, version: 1 },
        valid,
      };
    },
  });
}
