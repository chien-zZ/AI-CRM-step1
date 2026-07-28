import { FormSchemaError } from "./errors.js";
import type { FormPersistenceRuntime, FormSchemaStore } from "./store.js";
import type { FormDraft, FormOutboxEvent, FormRelease, FormUiSchema, JsonObject } from "./types.js";

interface DraftRow { definition_id: string; json_schema: JsonObject; owner_module: string; revision: number; ui_schema: FormUiSchema; updated_at: string }
interface ReleaseRow { active: boolean; content_digest: string; definition_id: string; json_schema: JsonObject; owner_module: string; published_at: string; release_version: number; ui_schema: FormUiSchema }
interface ReceiptRow { fingerprint: string; result: unknown }
const draft = (row: DraftRow): FormDraft => ({ definitionId: row.definition_id, jsonSchema: structuredClone(row.json_schema), ownerModule: row.owner_module, revision: row.revision, uiSchema: structuredClone(row.ui_schema), updatedAt: new Date(row.updated_at).toISOString() });
const release = (row: ReleaseRow): FormRelease => ({ active: row.active, contentDigest: row.content_digest, definitionId: row.definition_id, jsonSchema: structuredClone(row.json_schema), ownerModule: row.owner_module, publishedAt: new Date(row.published_at).toISOString(), releaseVersion: row.release_version, uiSchema: structuredClone(row.ui_schema), version: 1 });
const persistenceError = (error: unknown): never => {
  if (["23503", "23505", "23514", "55000"].includes(String((error as { code?: unknown }).code))) throw new FormSchemaError("form_operation_conflict", { cause: error });
  throw error;
};
const requiredRow = <T>(rows: readonly T[]): T => {
  const row = rows[0];
  if (row === undefined) throw new FormSchemaError("form_operation_conflict");
  return row;
};

export function createPostgresFormSchemaStore(runtime: FormPersistenceRuntime): FormSchemaStore {
  const lock = (key: string) => runtime.execute("select pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
  const receipt = async (operationId: string, fingerprint: string): Promise<ReceiptRow | undefined> => {
    const result = await runtime.execute<ReceiptRow>("select fingerprint,result from form_schema.operation_receipts where operation_id=$1 for update", [operationId]);
    const row = result.rows[0];
    if (row?.fingerprint !== undefined && row.fingerprint !== fingerprint) throw new FormSchemaError("form_operation_conflict");
    return row;
  };
  const saveReceipt = (operationId: string, fingerprint: string, result: unknown) => runtime.execute("insert into form_schema.operation_receipts(operation_id,fingerprint,result) values($1,$2,$3::jsonb)", [operationId, fingerprint, JSON.stringify(result)]);
  const saveEvent = (event: FormOutboxEvent) => runtime.execute("insert into form_schema.outbox_events(event_id,event_type,payload,occurred_at) values($1,$2,$3::jsonb,$4)", [event.eventId, event.eventType, JSON.stringify(event.payload), event.occurredAt]);
  const transaction = <T>(work: () => Promise<T>): Promise<T> => runtime.withTransaction(async () => {
    try {
      return await work();
    } catch (error) {
      return persistenceError(error);
    }
  });
  return {
    findDraft: async (definitionId) => {
      const result = await runtime.execute<DraftRow>("select * from form_schema.drafts where definition_id=$1", [definitionId]);
      return result.rows[0] === undefined ? undefined : draft(result.rows[0]);
    },
    findRelease: async (definitionId, releaseVersion) => {
      const result = await runtime.execute<ReleaseRow>("select r.definition_id,r.release_version,r.owner_module,r.content_digest,r.json_schema,r.ui_schema,r.published_at,s.active from form_schema.releases r join form_schema.release_status s using(definition_id,release_version) where r.definition_id=$1 and r.release_version=$2", [definitionId, releaseVersion]);
      return result.rows[0] === undefined ? undefined : release(result.rows[0]);
    },
    saveDraft: (input) => transaction(async () => {
      await lock(`operation:${input.operationId}`);
      const prior = await receipt(input.operationId, input.fingerprint);
      if (prior) return { ...(prior.result as { draft: FormDraft }), replayed: true };
      await lock(`definition:${input.draft.definitionId}`);
      const result = input.expectedRevision === 0
        ? await runtime.execute<DraftRow>("insert into form_schema.drafts(definition_id,owner_module,revision,json_schema,ui_schema,updated_at) values($1,$2,1,$3::jsonb,$4::jsonb,$5) returning *", [input.draft.definitionId, input.draft.ownerModule, JSON.stringify(input.draft.jsonSchema), JSON.stringify(input.draft.uiSchema), input.draft.updatedAt])
        : await runtime.execute<DraftRow>("update form_schema.drafts set revision=revision+1,json_schema=$3::jsonb,ui_schema=$4::jsonb,updated_at=$5 where definition_id=$1 and owner_module=$2 and revision=$6 returning *", [input.draft.definitionId, input.draft.ownerModule, JSON.stringify(input.draft.jsonSchema), JSON.stringify(input.draft.uiSchema), input.draft.updatedAt, input.expectedRevision]);
      if (result.rowCount !== 1) throw new FormSchemaError("form_operation_conflict");
      const saved = { draft: draft(requiredRow(result.rows)), replayed: false };
      await saveReceipt(input.operationId, input.fingerprint, saved);
      return saved;
    }),
    publish: (input) => transaction(async () => {
      await lock(`operation:${input.operationId}`);
      const prior = await receipt(input.operationId, input.fingerprint);
      if (prior) return { ...(prior.result as { release: FormRelease }), replayed: true };
      await lock(`definition:${input.definitionId}`);
      const draftRow = requiredRow((await runtime.execute<DraftRow>("select * from form_schema.drafts where definition_id=$1 and revision=$2 for update", [input.definitionId, input.expectedRevision])).rows);
      const releaseVersion = Number(requiredRow((await runtime.execute<{ next_version: number }>("select coalesce(max(release_version),0)+1 as next_version from form_schema.releases where definition_id=$1", [input.definitionId])).rows).next_version);
      const inserted = await runtime.execute<ReleaseRow>("insert into form_schema.releases(definition_id,release_version,owner_module,content_digest,json_schema,ui_schema,published_at) values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) returning *,true as active", [input.definitionId, releaseVersion, draftRow.owner_module, input.contentDigest, JSON.stringify(draftRow.json_schema), JSON.stringify(draftRow.ui_schema), input.publishedAt]);
      await runtime.execute("insert into form_schema.release_status(definition_id,release_version,active) values($1,$2,true)", [input.definitionId, releaseVersion]);
      const published = release(requiredRow(inserted.rows));
      await saveEvent({ ...input.event, payload: { definitionId: input.definitionId, releaseVersion } });
      const result = { release: published, replayed: false };
      await saveReceipt(input.operationId, input.fingerprint, result);
      return result;
    }),
    setActive: (input) => transaction(async () => {
      await lock(`operation:${input.operationId}`);
      const prior = await receipt(input.operationId, input.fingerprint);
      if (prior) return { replayed: true };
      await lock(`definition:${input.definitionId}`);
      const changed = await runtime.execute("update form_schema.release_status set active=$3 where definition_id=$1 and release_version=$2", [input.definitionId, input.releaseVersion, input.active]);
      if (changed.rowCount !== 1) throw new FormSchemaError("form_not_found");
      await saveEvent(input.event);
      const result = { replayed: false };
      await saveReceipt(input.operationId, input.fingerprint, result);
      return result;
    }),
  };
}
