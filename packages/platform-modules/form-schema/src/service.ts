import { randomUUID } from "node:crypto";

import { FormSchemaError } from "./errors.js";
import type { FormSchemaStore } from "./store.js";
import type { FormAudit, FormAuthorizationRequest, FormAuthorizer, FormDefinitionReference, FormOutboxEvent, FormRelease, FormSchemaService } from "./types.js";
import { command, compileSchema, decision, digest, fingerprint, identifier, positiveVersion, read, safeErrors, schema, ui } from "./validation.js";

export function createFormSchemaService(store: FormSchemaStore, authorizer: FormAuthorizer, audit: FormAudit, options: { readonly clock?: () => Date; readonly id?: () => string } = {}): FormSchemaService {
  const clock = options.clock ?? (() => new Date());
  const newId = options.id ?? randomUUID;
  const authorize = async (request: FormAuthorizationRequest) => {
    try {
      return decision(await authorizer.authorize(request));
    } catch (error) {
      throw new FormSchemaError("form_unavailable", { cause: error, retryable: true });
    }
  };
  const record = async (input: Parameters<FormAudit["record"]>[0]) => {
    try {
      await audit.record(input);
    } catch (error) {
      throw new FormSchemaError("form_unavailable", { cause: error, retryable: true });
    }
  };
  const authorizeBeforeLookup = async (meta: { actor: FormAuthorizationRequest["actor"]; operationId: string; reason: string; traceId: string }, action: string, authAction: FormAuthorizationRequest["action"], resourceId: string): Promise<void> => {
    const auth = await authorize({ action: authAction, actor: meta.actor, resourceId });
    if (!auth.allowed) {
      await record({ action, actor: meta.actor, authorizationDecisionId: auth.decisionId, operationId: meta.operationId, reason: meta.reason, resourceId, result: "denied", traceId: meta.traceId });
      throw new FormSchemaError("form_denied");
    }
  };
  const mutate = async <T>(meta: { actor: FormAuthorizationRequest["actor"]; operationId: string; reason: string; traceId: string }, action: string, authAction: FormAuthorizationRequest["action"], resourceId: string, ownerModule: string | undefined, work: () => Promise<T>): Promise<T> => {
    const auth = await authorize({ action: authAction, actor: meta.actor, ...(ownerModule === undefined ? {} : { ownerModule }), resourceId });
    const base = { action, actor: meta.actor, authorizationDecisionId: auth.decisionId, operationId: meta.operationId, reason: meta.reason, resourceId, traceId: meta.traceId };
    if (!auth.allowed) {
      await record({ ...base, result: "denied" });
      throw new FormSchemaError("form_denied");
    }
    await record({ ...base, result: "attempted" });
    let result: T;
    try {
      result = await work();
    } catch (error) {
      await record({ ...base, result: "failed" });
      if (error instanceof FormSchemaError) throw error;
      throw new FormSchemaError("form_unavailable", { cause: error, retryable: true });
    }
    await record({ ...base, result: "succeeded" });
    return result;
  };
  const findDraft = async (definitionId: string) => {
    try {
      return await store.findDraft(definitionId);
    } catch (error) {
      throw new FormSchemaError("form_unavailable", { cause: error, retryable: true });
    }
  };
  const findRelease = async (definitionId: string, releaseVersion: number) => {
    try {
      return await store.findRelease(definitionId, releaseVersion);
    } catch (error) {
      throw new FormSchemaError("form_unavailable", { cause: error, retryable: true });
    }
  };
  const reference = (release: FormRelease): FormDefinitionReference => ({ contentDigest: release.contentDigest, definitionId: release.definitionId, releaseVersion: release.releaseVersion, version: 1 });

  return {
    saveDraft: async (input) => {
      const parsed = command(input, ["definitionId", "expectedRevision", "jsonSchema", "ownerModule", "uiSchema"]);
      const definitionId = identifier(parsed.values.definitionId);
      const ownerModule = identifier(parsed.values.ownerModule);
      const expectedRevision = positiveVersion(parsed.values.expectedRevision, true);
      const jsonSchema = schema(parsed.values.jsonSchema);
      const uiSchema = ui(parsed.values.uiSchema, jsonSchema);
      if (expectedRevision > 0) {
        await authorizeBeforeLookup(parsed, "form.draft.save", "form:manage", definitionId);
        const current = await findDraft(definitionId);
        if (!current || current.ownerModule !== ownerModule) throw new FormSchemaError("form_operation_conflict");
      }
      const draft = { definitionId, jsonSchema, ownerModule, uiSchema, updatedAt: clock().toISOString() };
      return mutate(parsed, "form.draft.save", "form:manage", definitionId, ownerModule, () => store.saveDraft({ draft, expectedRevision, fingerprint: fingerprint({ definitionId, expectedRevision, jsonSchema, ownerModule, uiSchema }), operationId: parsed.operationId }));
    },
    publish: async (input) => {
      const parsed = command(input, ["definitionId", "expectedRevision"]);
      const definitionId = identifier(parsed.values.definitionId);
      const expectedRevision = positiveVersion(parsed.values.expectedRevision);
      await authorizeBeforeLookup(parsed, "form.release.publish", "form:publish", definitionId);
      const draft = await findDraft(definitionId);
      if (!draft) throw new FormSchemaError("form_not_found");
      compileSchema(draft.jsonSchema);
      const publishedAt = clock().toISOString();
      const event: FormOutboxEvent = { eventId: newId(), eventType: "form.release.published", occurredAt: publishedAt, payload: { definitionId, releaseVersion: 0 } };
      const result = await mutate(parsed, "form.release.publish", "form:publish", definitionId, draft.ownerModule, () => store.publish({ contentDigest: digest(draft.jsonSchema, draft.uiSchema), definitionId, event, expectedRevision, fingerprint: fingerprint({ definitionId, expectedRevision }), operationId: parsed.operationId, publishedAt }));
      return { reference: reference(result.release), replayed: result.replayed };
    },
    setReleaseActive: async (input) => {
      const parsed = command(input, ["active", "definitionId", "releaseVersion"]);
      const definitionId = identifier(parsed.values.definitionId);
      const releaseVersion = positiveVersion(parsed.values.releaseVersion);
      if (typeof parsed.values.active !== "boolean") throw new FormSchemaError("form_invalid_input");
      await authorizeBeforeLookup(parsed, "form.release.active", "form:publish", definitionId);
      const release = await findRelease(definitionId, releaseVersion);
      if (!release) throw new FormSchemaError("form_not_found");
      const active = parsed.values.active;
      const event: FormOutboxEvent = { eventId: newId(), eventType: "form.release.active_changed", occurredAt: clock().toISOString(), payload: { definitionId, releaseVersion } };
      return mutate(parsed, "form.release.active", "form:publish", definitionId, release.ownerModule, () => store.setActive({ active, definitionId, event, fingerprint: fingerprint({ active, definitionId, releaseVersion }), operationId: parsed.operationId, releaseVersion }));
    },
    getRelease: async (input) => {
      const parsed = read(input);
      const auth = await authorize({ action: "form:read", actor: parsed.actor, resourceId: parsed.definitionId });
      if (!auth.allowed) throw new FormSchemaError("form_denied");
      const release = await findRelease(parsed.definitionId, parsed.releaseVersion);
      if (!release) throw new FormSchemaError("form_not_found");
      return release;
    },
    validateSubmission: async (input) => {
      const parsed = read(input, true);
      const auth = await authorize({ action: "form:validate", actor: parsed.actor, resourceId: parsed.definitionId });
      if (!auth.allowed) throw new FormSchemaError("form_denied");
      const release = await findRelease(parsed.definitionId, parsed.releaseVersion);
      if (!release || !release.active) throw new FormSchemaError("form_not_found");
      const validate = compileSchema(release.jsonSchema);
      const valid = validate(parsed.data);
      return { errors: safeErrors(validate.errors), reference: reference(release), valid };
    },
  };
}
