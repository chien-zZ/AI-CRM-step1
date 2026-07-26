import { BusinessConfigurationError } from "./errors.js";
import type { BusinessConfigurationStore, ConfigurationPersistenceRuntime } from "./store.js";
import type { ConfigurationInvalidationEvent, DictionaryDraft, DictionaryItem, DictionaryRelease, ParameterActivation, ParameterActivationTermination, ParameterDefinition, ParameterValueRelease } from "./types.js";
import { hash } from "./validation.js";

interface DraftRow { dictionary_id: string; items: DictionaryItem[]; owner_module: string; revision: number; updated_at: string }
interface DictionaryRow { content_digest: string; dictionary_id: string; items: DictionaryItem[]; owner_module: string; published_at: string; release_version: number }
interface DefinitionRow { definition: ParameterDefinition; parameter_key: string }
interface ValueRow { content_digest: string; parameter_key: string; published_at: string; value: ParameterValueRelease["value"]; value_version: number }
interface ActivationRow { activation_id: string; effective_from: string; effective_to: string | null; parameter_key: string; scope_reference: string; scope_type: string; value_version: number }
interface TerminationRow { activation_id: string; effective_to: string; occurred_at: string; parameter_key: string; termination_id: string }
interface ReceiptRow { fingerprint: string; result: unknown }

const required = <T>(rows: readonly T[]): T => {
  const row = rows[0];
  if (row === undefined) throw new BusinessConfigurationError("configuration_operation_conflict");
  return row;
};
const draft = (row: DraftRow): DictionaryDraft => ({ dictionaryId: row.dictionary_id, items: structuredClone(row.items), ownerModule: row.owner_module, revision: row.revision, updatedAt: new Date(row.updated_at).toISOString() });
const dictionary = (row: DictionaryRow): DictionaryRelease => ({ contentDigest: row.content_digest, dictionaryId: row.dictionary_id, items: structuredClone(row.items), ownerModule: row.owner_module, publishedAt: new Date(row.published_at).toISOString(), releaseVersion: row.release_version, version: 1 });
const valueRelease = (row: ValueRow): ParameterValueRelease => ({ contentDigest: row.content_digest, parameterKey: row.parameter_key, publishedAt: new Date(row.published_at).toISOString(), value: row.value, valueVersion: row.value_version, version: 1 });
const activation = (row: ActivationRow): ParameterActivation => ({ activationId: row.activation_id, effectiveFrom: new Date(row.effective_from).toISOString(), ...(row.effective_to === null ? {} : { effectiveTo: new Date(row.effective_to).toISOString() }), parameterKey: row.parameter_key, scope: { scopeReference: row.scope_reference, scopeType: row.scope_type }, valueVersion: row.value_version });
const termination = (row: TerminationRow): ParameterActivationTermination => ({ activationId: row.activation_id, effectiveTo: new Date(row.effective_to).toISOString(), occurredAt: new Date(row.occurred_at).toISOString(), parameterKey: row.parameter_key, terminationId: row.termination_id, version: 1 });
const persistenceError = (error: unknown): never => {
  const code = String((error as { code?: unknown }).code);
  if (code === "23503") throw new BusinessConfigurationError("configuration_not_found", { cause: error });
  if (["23505", "23514", "55000"].includes(code)) throw new BusinessConfigurationError("configuration_operation_conflict", { cause: error });
  throw error;
};

export function createPostgresBusinessConfigurationStore(runtime: ConfigurationPersistenceRuntime): BusinessConfigurationStore {
  const receipt = async (operationId: string, fingerprint: string): Promise<ReceiptRow | undefined> => {
    const query = await runtime.execute<ReceiptRow>("select fingerprint,result from business_configuration.operation_receipts where operation_id=$1 for update", [operationId]);
    const row = query.rows[0];
    if (row?.fingerprint !== undefined && row.fingerprint !== fingerprint) throw new BusinessConfigurationError("configuration_operation_conflict");
    return row;
  };
  const saveReceipt = (operationId: string, fingerprint: string, result: unknown) => runtime.execute("insert into business_configuration.operation_receipts(operation_id,fingerprint,result) values($1,$2,$3::jsonb)", [operationId, fingerprint, JSON.stringify(result)]);
  const saveEvent = (event: ConfigurationInvalidationEvent) => runtime.execute("insert into business_configuration.outbox_events(event_id,event_type,resource_id,resource_version,occurred_at) values($1,$2,$3,$4,$5)", [event.eventId, event.eventType, event.resourceId, event.version, event.occurredAt]);
  const lock = (key: string) => runtime.execute("select pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
  const transaction = <T>(work: () => Promise<T>): Promise<T> => runtime.withTransaction(async () => {
    try {
      return await work();
    } catch (error) {
      return persistenceError(error);
    }
  });

  return {
    findDictionaryDraft: async (dictionaryId) => {
      const query = await runtime.execute<DraftRow>("select * from business_configuration.dictionary_drafts where dictionary_id=$1", [dictionaryId]);
      return query.rows[0] === undefined ? undefined : draft(query.rows[0]);
    },
    findDictionaryRelease: async (dictionaryId, releaseVersion) => {
      const query = await runtime.execute<DictionaryRow>("select * from business_configuration.dictionary_releases where dictionary_id=$1 and release_version=$2", [dictionaryId, releaseVersion]);
      return query.rows[0] === undefined ? undefined : dictionary(query.rows[0]);
    },
    findParameterDefinition: async (parameterKey) => {
      const query = await runtime.execute<DefinitionRow>("select parameter_key,definition from business_configuration.parameter_definitions where parameter_key=$1", [parameterKey]);
      return query.rows[0] === undefined ? undefined : structuredClone(query.rows[0].definition);
    },
    findParameterValue: async (parameterKey, valueVersion) => {
      const query = await runtime.execute<ValueRow>("select * from business_configuration.parameter_values where parameter_key=$1 and value_version=$2", [parameterKey, valueVersion]);
      return query.rows[0] === undefined ? undefined : valueRelease(query.rows[0]);
    },
    listEffectiveActivations: async (parameterKey, scopes, at) => {
      if (scopes.length === 0) return [];
      const scopeTypes = scopes.map((candidate) => candidate.scopeType);
      const scopeReferences = scopes.map((candidate) => candidate.scopeReference);
      const query = await runtime.execute<ActivationRow>("select a.activation_id,a.parameter_key,a.value_version,a.scope_type,a.scope_reference,a.effective_from,least(a.effective_to,t.effective_to) effective_to from business_configuration.parameter_activations a left join business_configuration.parameter_activation_terminations t using(activation_id) where a.parameter_key=$1 and (a.scope_type,a.scope_reference) in (select * from unnest($2::text[],$3::text[])) and a.effective_from<=$4 and (least(a.effective_to,t.effective_to) is null or $4<least(a.effective_to,t.effective_to))", [parameterKey, scopeTypes, scopeReferences, at]);
      return query.rows.map(activation);
    },
    saveDictionaryDraft: (input) => transaction(async () => {
      await lock(`operation:${input.operationId}`);
      const prior = await receipt(input.operationId, input.fingerprint);
      if (prior) return { ...(prior.result as { draft: DictionaryDraft }), replayed: true };
      await lock(`dictionary:${input.draft.dictionaryId}`);
      const query = input.expectedRevision === 0
        ? await runtime.execute<DraftRow>("insert into business_configuration.dictionary_drafts(dictionary_id,owner_module,revision,items,updated_at) values($1,$2,1,$3::jsonb,$4) returning *", [input.draft.dictionaryId, input.draft.ownerModule, JSON.stringify(input.draft.items), input.draft.updatedAt])
        : await runtime.execute<DraftRow>("update business_configuration.dictionary_drafts set revision=revision+1,items=$3::jsonb,updated_at=$4 where dictionary_id=$1 and owner_module=$2 and revision=$5 returning *", [input.draft.dictionaryId, input.draft.ownerModule, JSON.stringify(input.draft.items), input.draft.updatedAt, input.expectedRevision]);
      if (query.rowCount !== 1) throw new BusinessConfigurationError("configuration_operation_conflict");
      const result = { draft: draft(required(query.rows)), replayed: false };
      await saveReceipt(input.operationId, input.fingerprint, result);
      return result;
    }),
    publishDictionary: (input) => transaction(async () => {
      await lock(`operation:${input.operationId}`);
      const prior = await receipt(input.operationId, input.fingerprint);
      if (prior) return { ...(prior.result as { release: DictionaryRelease }), replayed: true };
      await lock(`dictionary:${input.dictionaryId}`);
      const row = required((await runtime.execute<DraftRow>("select * from business_configuration.dictionary_drafts where dictionary_id=$1 and revision=$2 for update", [input.dictionaryId, input.expectedRevision])).rows);
      const previous = await runtime.execute<{ items: DictionaryItem[] }>("select items from business_configuration.dictionary_releases where dictionary_id=$1", [input.dictionaryId]);
      const nextCodes = new Set(row.items.map((item) => item.code));
      if (previous.rows.flatMap((release) => release.items).some((item) => !nextCodes.has(item.code))) throw new BusinessConfigurationError("configuration_operation_conflict");
      const releaseVersion = Number(required((await runtime.execute<{ next_version: number }>("select coalesce(max(release_version),0)+1 next_version from business_configuration.dictionary_releases where dictionary_id=$1", [input.dictionaryId])).rows).next_version);
      const inserted = required((await runtime.execute<DictionaryRow>("insert into business_configuration.dictionary_releases(dictionary_id,release_version,owner_module,content_digest,items,published_at) values($1,$2,$3,$4,$5::jsonb,$6) returning *", [input.dictionaryId, releaseVersion, row.owner_module, hash({ items: row.items }), JSON.stringify(row.items), input.publishedAt])).rows);
      const result = { release: dictionary(inserted), replayed: false };
      await saveEvent({ ...input.event, version: releaseVersion });
      await saveReceipt(input.operationId, input.fingerprint, result);
      return result;
    }),
    registerParameter: (input) => transaction(async () => {
      await lock(`operation:${input.operationId}`);
      const prior = await receipt(input.operationId, input.fingerprint);
      if (prior) return { ...(prior.result as { definition: ParameterDefinition }), replayed: true };
      await lock(`parameter:${input.definition.parameterKey}`);
      const query = await runtime.execute("insert into business_configuration.parameter_definitions(parameter_key,definition) values($1,$2::jsonb)", [input.definition.parameterKey, JSON.stringify(input.definition)]);
      if (query.rowCount !== 1) throw new BusinessConfigurationError("configuration_operation_conflict");
      const result = { definition: structuredClone(input.definition), replayed: false };
      await saveReceipt(input.operationId, input.fingerprint, result);
      return result;
    }),
    publishParameterValue: (input) => transaction(async () => {
      await lock(`operation:${input.operationId}`);
      const prior = await receipt(input.operationId, input.fingerprint);
      if (prior) return { ...(prior.result as { release: ParameterValueRelease }), replayed: true };
      await lock(`parameter:${input.parameterKey}`);
      if ((await runtime.execute("select 1 from business_configuration.parameter_definitions where parameter_key=$1", [input.parameterKey])).rows[0] === undefined) throw new BusinessConfigurationError("configuration_not_found");
      const valueVersion = Number(required((await runtime.execute<{ next_version: number }>("select coalesce(max(value_version),0)+1 next_version from business_configuration.parameter_values where parameter_key=$1", [input.parameterKey])).rows).next_version);
      const inserted = required((await runtime.execute<ValueRow>("insert into business_configuration.parameter_values(parameter_key,value_version,content_digest,value,published_at) values($1,$2,$3,$4::jsonb,$5) returning *", [input.parameterKey, valueVersion, input.contentDigest, JSON.stringify(input.value), input.publishedAt])).rows);
      const result = { release: valueRelease(inserted), replayed: false };
      await saveEvent({ ...input.event, version: valueVersion });
      await saveReceipt(input.operationId, input.fingerprint, result);
      return result;
    }),
    activate: (input) => transaction(async () => {
      await lock(`operation:${input.operationId}`);
      const prior = await receipt(input.operationId, input.fingerprint);
      if (prior) return { replayed: true };
      const candidate = input.activation;
      await lock(`activation:${candidate.parameterKey}:${candidate.scope.scopeType}:${candidate.scope.scopeReference}`);
      const overlap = await runtime.execute("select 1 from business_configuration.parameter_activations a left join business_configuration.parameter_activation_terminations t using(activation_id) where a.parameter_key=$1 and a.scope_type=$2 and a.scope_reference=$3 and a.effective_from<coalesce($5::timestamptz,'infinity') and $4::timestamptz<coalesce(least(a.effective_to,t.effective_to),'infinity') limit 1", [candidate.parameterKey, candidate.scope.scopeType, candidate.scope.scopeReference, candidate.effectiveFrom, candidate.effectiveTo ?? null]);
      if (overlap.rows[0] !== undefined) throw new BusinessConfigurationError("configuration_overlap");
      await runtime.execute("insert into business_configuration.parameter_activations(activation_id,parameter_key,value_version,scope_type,scope_reference,effective_from,effective_to) values($1,$2,$3,$4,$5,$6,$7)", [candidate.activationId, candidate.parameterKey, candidate.valueVersion, candidate.scope.scopeType, candidate.scope.scopeReference, candidate.effectiveFrom, candidate.effectiveTo ?? null]);
      await saveEvent(input.event);
      const result = { replayed: false };
      await saveReceipt(input.operationId, input.fingerprint, result);
      return result;
    }),
    terminateActivation: (input) => transaction(async () => {
      await lock(`operation:${input.operationId}`);
      const prior = await receipt(input.operationId, input.fingerprint);
      if (prior) return { ...(prior.result as { termination: ParameterActivationTermination }), replayed: true };
      const activationQuery = await runtime.execute<ActivationRow>("select * from business_configuration.parameter_activations where activation_id=$1 and parameter_key=$2 for update", [input.activationId, input.parameterKey]);
      const activationRow = activationQuery.rows[0];
      if (activationRow === undefined) throw new BusinessConfigurationError("configuration_not_found");
      await lock(`activation:${activationRow.parameter_key}:${activationRow.scope_type}:${activationRow.scope_reference}`);
      if (input.effectiveTo < input.occurredAt || input.effectiveTo <= new Date(activationRow.effective_from).toISOString() || (activationRow.effective_to !== null && input.effectiveTo > new Date(activationRow.effective_to).toISOString())) throw new BusinessConfigurationError("configuration_operation_conflict");
      const inserted = required((await runtime.execute<TerminationRow>("insert into business_configuration.parameter_activation_terminations(termination_id,activation_id,parameter_key,effective_to,occurred_at) values($1,$2,$3,$4,$5) returning *", [input.terminationId, input.activationId, input.parameterKey, input.effectiveTo, input.occurredAt])).rows);
      const result = { replayed: false, termination: termination(inserted) };
      await saveEvent(input.event);
      await saveReceipt(input.operationId, input.fingerprint, result);
      return result;
    }),
  };
}
