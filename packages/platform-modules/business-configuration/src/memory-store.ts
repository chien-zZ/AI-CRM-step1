import { BusinessConfigurationError } from "./errors.js";
import type { BusinessConfigurationStore } from "./store.js";
import type { ConfigurationInvalidationEvent, DictionaryDraft, DictionaryRelease, ParameterActivation, ParameterActivationTermination, ParameterDefinition, ParameterValueRelease } from "./types.js";
import { hash } from "./validation.js";

export function createMemoryBusinessConfigurationStore(): BusinessConfigurationStore {
  const drafts = new Map<string, DictionaryDraft>();
  const dictionaries = new Map<string, DictionaryRelease[]>();
  const definitions = new Map<string, ParameterDefinition>();
  const values = new Map<string, ParameterValueRelease[]>();
  const activations: ParameterActivation[] = [];
  const terminations = new Map<string, ParameterActivationTermination>();
  const receipts = new Map<string, { fingerprint: string; result: unknown }>();
  const outbox = new Map<string, ConfigurationInvalidationEvent>();
  const replay = (operationId: string, fingerprint: string): unknown => {
    const prior = receipts.get(operationId);
    if (!prior) return undefined;
    if (prior.fingerprint !== fingerprint) throw new BusinessConfigurationError("configuration_operation_conflict");
    return structuredClone(prior.result);
  };
  const save = (operationId: string, fingerprint: string, result: unknown) => receipts.set(operationId, { fingerprint, result: structuredClone(result) });
  const effectiveEnd = (activation: ParameterActivation): string | undefined => {
    const terminated = terminations.get(activation.activationId)?.effectiveTo;
    if (activation.effectiveTo === undefined) return terminated;
    if (terminated === undefined) return activation.effectiveTo;
    return terminated < activation.effectiveTo ? terminated : activation.effectiveTo;
  };
  const materialize = (activation: ParameterActivation): ParameterActivation => {
    const effectiveTo = effectiveEnd(activation);
    return { ...structuredClone(activation), ...(effectiveTo === undefined ? {} : { effectiveTo }) };
  };

  return {
    findDictionaryDraft: (dictionaryId) => Promise.resolve(drafts.has(dictionaryId) ? structuredClone(drafts.get(dictionaryId)) : undefined),
    findDictionaryRelease: (dictionaryId, releaseVersion) => Promise.resolve(structuredClone(dictionaries.get(dictionaryId)?.find((release) => release.releaseVersion === releaseVersion))),
    findParameterDefinition: (parameterKey) => Promise.resolve(definitions.has(parameterKey) ? structuredClone(definitions.get(parameterKey)) : undefined),
    findParameterValue: (parameterKey, valueVersion) => Promise.resolve(structuredClone(values.get(parameterKey)?.find((release) => release.valueVersion === valueVersion))),
    listEffectiveActivations: (parameterKey, scopes, at) => Promise.resolve(activations.filter((activation) => {
      const end = effectiveEnd(activation);
      return activation.parameterKey === parameterKey && scopes.some((candidate) => candidate.scopeType === activation.scope.scopeType && candidate.scopeReference === activation.scope.scopeReference) && activation.effectiveFrom <= at && (end === undefined || at < end);
    }).map(materialize)),
    saveDictionaryDraft: (input) => {
      const prior = replay(input.operationId, input.fingerprint) as { draft: DictionaryDraft } | undefined;
      if (prior) return Promise.resolve({ ...prior, replayed: true });
      const current = drafts.get(input.draft.dictionaryId);
      if ((current?.revision ?? 0) !== input.expectedRevision || (current !== undefined && current.ownerModule !== input.draft.ownerModule)) throw new BusinessConfigurationError("configuration_operation_conflict");
      const draft = { ...structuredClone(input.draft), revision: input.expectedRevision + 1 };
      drafts.set(draft.dictionaryId, draft);
      const result = { draft, replayed: false };
      save(input.operationId, input.fingerprint, result);
      return Promise.resolve(structuredClone(result));
    },
    publishDictionary: (input) => {
      const prior = replay(input.operationId, input.fingerprint) as { release: DictionaryRelease } | undefined;
      if (prior) return Promise.resolve({ ...prior, replayed: true });
      const draft = drafts.get(input.dictionaryId);
      if (!draft || draft.revision !== input.expectedRevision) throw new BusinessConfigurationError("configuration_operation_conflict");
      const list = dictionaries.get(input.dictionaryId) ?? [];
      const oldCodes = new Set(list.flatMap((release) => release.items.map((item) => item.code)));
      const newCodes = new Set(draft.items.map((item) => item.code));
      if ([...oldCodes].some((code) => !newCodes.has(code))) throw new BusinessConfigurationError("configuration_operation_conflict");
      const release: DictionaryRelease = { contentDigest: hash({ items: draft.items }), dictionaryId: draft.dictionaryId, items: structuredClone(draft.items), ownerModule: draft.ownerModule, publishedAt: input.publishedAt, releaseVersion: list.length + 1, version: 1 };
      list.push(release);
      dictionaries.set(draft.dictionaryId, list);
      outbox.set(input.event.eventId, { ...input.event, version: release.releaseVersion });
      const result = { release, replayed: false };
      save(input.operationId, input.fingerprint, result);
      return Promise.resolve(structuredClone(result));
    },
    registerParameter: (input) => {
      const prior = replay(input.operationId, input.fingerprint) as { definition: ParameterDefinition } | undefined;
      if (prior) return Promise.resolve({ ...prior, replayed: true });
      if (definitions.has(input.definition.parameterKey)) throw new BusinessConfigurationError("configuration_operation_conflict");
      definitions.set(input.definition.parameterKey, structuredClone(input.definition));
      const result = { definition: input.definition, replayed: false };
      save(input.operationId, input.fingerprint, result);
      return Promise.resolve(structuredClone(result));
    },
    publishParameterValue: (input) => {
      const prior = replay(input.operationId, input.fingerprint) as { release: ParameterValueRelease } | undefined;
      if (prior) return Promise.resolve({ ...prior, replayed: true });
      if (!definitions.has(input.parameterKey)) throw new BusinessConfigurationError("configuration_not_found");
      const list = values.get(input.parameterKey) ?? [];
      const release: ParameterValueRelease = { contentDigest: input.contentDigest, parameterKey: input.parameterKey, publishedAt: input.publishedAt, value: input.value as ParameterValueRelease["value"], valueVersion: list.length + 1, version: 1 };
      list.push(release);
      values.set(input.parameterKey, list);
      outbox.set(input.event.eventId, { ...input.event, version: release.valueVersion });
      const result = { release, replayed: false };
      save(input.operationId, input.fingerprint, result);
      return Promise.resolve(structuredClone(result));
    },
    activate: (input) => {
      const prior = replay(input.operationId, input.fingerprint) as { replayed: boolean } | undefined;
      if (prior) return Promise.resolve({ replayed: true });
      const candidate = input.activation;
      if (!definitions.has(candidate.parameterKey) || !values.get(candidate.parameterKey)?.some((release) => release.valueVersion === candidate.valueVersion)) throw new BusinessConfigurationError("configuration_not_found");
      const candidateEnd = candidate.effectiveTo ?? "9999-12-31T23:59:59.999Z";
      if (activations.some((current) => current.parameterKey === candidate.parameterKey && current.scope.scopeType === candidate.scope.scopeType && current.scope.scopeReference === candidate.scope.scopeReference && current.effectiveFrom < candidateEnd && candidate.effectiveFrom < (effectiveEnd(current) ?? "9999-12-31T23:59:59.999Z"))) throw new BusinessConfigurationError("configuration_overlap");
      activations.push(structuredClone(candidate));
      outbox.set(input.event.eventId, structuredClone(input.event));
      const result = { replayed: false };
      save(input.operationId, input.fingerprint, result);
      return Promise.resolve(result);
    },
    terminateActivation: (input) => {
      const prior = replay(input.operationId, input.fingerprint) as { termination: ParameterActivationTermination } | undefined;
      if (prior) return Promise.resolve({ ...prior, replayed: true });
      const activation = activations.find((candidate) => candidate.activationId === input.activationId && candidate.parameterKey === input.parameterKey);
      if (!activation) throw new BusinessConfigurationError("configuration_not_found");
      if (terminations.has(activation.activationId) || input.effectiveTo < input.occurredAt || input.effectiveTo <= activation.effectiveFrom || (activation.effectiveTo !== undefined && input.effectiveTo > activation.effectiveTo)) throw new BusinessConfigurationError("configuration_operation_conflict");
      const termination: ParameterActivationTermination = { activationId: activation.activationId, effectiveTo: input.effectiveTo, occurredAt: input.occurredAt, parameterKey: activation.parameterKey, terminationId: input.terminationId, version: 1 };
      terminations.set(activation.activationId, termination);
      outbox.set(input.event.eventId, structuredClone(input.event));
      const result = { replayed: false, termination };
      save(input.operationId, input.fingerprint, result);
      return Promise.resolve(structuredClone(result));
    },
  };
}
