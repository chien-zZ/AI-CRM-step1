import { randomUUID } from "node:crypto";

import { BusinessConfigurationError } from "./errors.js";
import type { BusinessConfigurationStore } from "./store.js";
import type {
  BusinessConfigurationService,
  ConfigurationAudit,
  ConfigurationAuthorizationRequest,
  ConfigurationAuthorizer,
  ConfigurationCache,
  ConfigurationInvalidationEvent,
  ConfigurationValue,
  ParameterDefinition,
  ResolvedParameter,
} from "./types.js";
import { actor, command, compile, date, decision, definition, hash, id, itemList, scope, uuid, value, version } from "./validation.js";

const invalid = (): never => {
  throw new BusinessConfigurationError("configuration_invalid_input");
};

const object = (input: unknown): Record<string, unknown> =>
  typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : invalid();

const exact = (input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> => {
  const parsed = object(input);
  if (required.some((key) => !Object.hasOwn(parsed, key)) || Object.keys(parsed).some((key) => !required.includes(key) && !optional.includes(key))) invalid();
  return parsed;
};

const configurationValue = (input: unknown): ConfigurationValue => {
  if (typeof input === "string" || typeof input === "boolean" || (typeof input === "number" && Number.isFinite(input))) return input;
  return invalid();
};

const cachedResolution = (input: unknown, expectedParameterKey: string, parameterDefinition: ParameterDefinition, requestedScopes: readonly { readonly scopeReference: string; readonly scopeType: string }[], at: string): ResolvedParameter | undefined => {
  try {
    const parsed = object(input);
    if (parsed.source === "default") {
      const result = exact(parsed, ["definitionVersion", "parameterKey", "source", "value", "valueVersion", "version"]);
      if (id(result.parameterKey) !== expectedParameterKey || result.source !== "default" || version(result.definitionVersion) !== 1 || version(result.valueVersion, true) !== 0 || version(result.version) !== 1) return undefined;
      const parsedValue = value(configurationValue(result.value), parameterDefinition.valueType);
      if (parameterDefinition.missingPolicy !== "use_default" || parameterDefinition.defaultValue !== parsedValue || !compile(parameterDefinition)(parsedValue)) return undefined;
      return { definitionVersion: 1, parameterKey: expectedParameterKey, source: "default", value: parsedValue, valueVersion: 0, version: 1 };
    }
    if (parsed.source === "activation") {
      const result = exact(parsed, ["activationId", "definitionVersion", "effectiveFrom", "parameterKey", "scope", "source", "value", "valueVersion", "version"], ["effectiveTo"]);
      if (id(result.parameterKey) !== expectedParameterKey || version(result.definitionVersion) !== 1 || version(result.version) !== 1) return undefined;
      const effectiveFrom = date(result.effectiveFrom);
      const effectiveTo = result.effectiveTo === undefined ? undefined : date(result.effectiveTo);
      if (effectiveTo !== undefined && effectiveTo <= effectiveFrom) return undefined;
      const parsedScope = scope(result.scope);
      if (!requestedScopes.some((candidate) => candidate.scopeType === parsedScope.scopeType && candidate.scopeReference === parsedScope.scopeReference)) return undefined;
      if (!parameterDefinition.allowedScopes.some((candidate) => candidate.scopeType === parsedScope.scopeType) || effectiveFrom > at || (effectiveTo !== undefined && at >= effectiveTo)) return undefined;
      const parsedValue = value(configurationValue(result.value), parameterDefinition.valueType);
      if (!compile(parameterDefinition)(parsedValue)) return undefined;
      return {
        activationId: uuid(result.activationId), definitionVersion: 1, effectiveFrom,
        ...(effectiveTo === undefined ? {} : { effectiveTo }), parameterKey: expectedParameterKey,
        scope: parsedScope, source: "activation", value: parsedValue,
        valueVersion: version(result.valueVersion), version: 1,
      };
    }
  } catch (error) {
    if (!(error instanceof BusinessConfigurationError)) throw error;
  }
  return undefined;
};

export function createBusinessConfigurationService(
  store: BusinessConfigurationStore,
  authorizer: ConfigurationAuthorizer,
  audit: ConfigurationAudit,
  cache: ConfigurationCache,
  options: { readonly clock?: () => Date; readonly id?: () => string } = {},
): BusinessConfigurationService {
  const clock = options.clock ?? (() => new Date());
  const newId = options.id ?? randomUUID;
  const authorize = async (request: ConfigurationAuthorizationRequest) => {
    try {
      return decision(await authorizer.authorize(request));
    } catch (error) {
      throw new BusinessConfigurationError("configuration_unavailable", { cause: error, retryable: true });
    }
  };
  const record = async (input: Parameters<ConfigurationAudit["record"]>[0]) => {
    try {
      await audit.record(input);
    } catch (error) {
      throw new BusinessConfigurationError("configuration_unavailable", { cause: error, retryable: true });
    }
  };
  const authorizeBeforeLookup = async (meta: { actor: ConfigurationAuthorizationRequest["actor"]; operationId: string; reason: string; traceId: string }, action: string, authAction: ConfigurationAuthorizationRequest["action"], resourceId: string): Promise<void> => {
    const auth = await authorize({ action: authAction, actor: meta.actor, resourceId });
    if (!auth.allowed) {
      await record({ action, actor: meta.actor, authorizationDecisionId: auth.decisionId, operationId: meta.operationId, reason: meta.reason, resourceId, result: "denied", traceId: meta.traceId });
      throw new BusinessConfigurationError("configuration_denied");
    }
  };
  const mutate = async <T>(
    meta: { actor: ConfigurationAuthorizationRequest["actor"]; operationId: string; reason: string; traceId: string },
    action: string,
    authAction: ConfigurationAuthorizationRequest["action"],
    resourceId: string,
    ownerModule: string | undefined,
    work: () => Promise<T>,
  ): Promise<T> => {
    const auth = await authorize({ action: authAction, actor: meta.actor, ...(ownerModule === undefined ? {} : { ownerModule }), resourceId });
    const base = { action, actor: meta.actor, authorizationDecisionId: auth.decisionId, operationId: meta.operationId, reason: meta.reason, resourceId, traceId: meta.traceId };
    if (!auth.allowed) {
      await record({ ...base, result: "denied" });
      throw new BusinessConfigurationError("configuration_denied");
    }
    await record({ ...base, result: "attempted" });
    let result: T;
    try {
      result = await work();
    } catch (error) {
      await record({ ...base, result: "failed" });
      if (error instanceof BusinessConfigurationError) throw error;
      throw new BusinessConfigurationError("configuration_unavailable", { cause: error, retryable: true });
    }
    await record({ ...base, result: "succeeded" });
    return result;
  };
  const event = (eventType: ConfigurationInvalidationEvent["eventType"], resourceId: string): ConfigurationInvalidationEvent => ({ eventId: newId(), eventType, occurredAt: clock().toISOString(), resourceId, version: 0 });
  const findDefinition = async (key: string) => {
    try {
      const found = await store.findParameterDefinition(key);
      if (!found) throw new BusinessConfigurationError("configuration_not_found");
      return found;
    } catch (error) {
      if (error instanceof BusinessConfigurationError) throw error;
      throw new BusinessConfigurationError("configuration_unavailable", { cause: error, retryable: true });
    }
  };

  return {
    saveDictionaryDraft: async (input) => {
      const parsed = command(input, ["dictionaryId", "expectedRevision", "items", "ownerModule"]);
      const dictionaryId = id(parsed.values.dictionaryId);
      const ownerModule = id(parsed.values.ownerModule);
      const expectedRevision = version(parsed.values.expectedRevision, true);
      const items = itemList(parsed.values.items);
      if (expectedRevision > 0) {
        await authorizeBeforeLookup(parsed, "configuration.dictionary.draft.save", "configuration:manage", dictionaryId);
        let current;
        try {
          current = await store.findDictionaryDraft(dictionaryId);
        } catch (error) {
          throw new BusinessConfigurationError("configuration_unavailable", { cause: error, retryable: true });
        }
        if (!current || current.ownerModule !== ownerModule) throw new BusinessConfigurationError("configuration_operation_conflict");
      }
      const draft = { dictionaryId, items, ownerModule, updatedAt: clock().toISOString() };
      return mutate(parsed, "configuration.dictionary.draft.save", "configuration:manage", dictionaryId, ownerModule, () => store.saveDictionaryDraft({ draft, expectedRevision, fingerprint: hash({ dictionaryId, expectedRevision, items, ownerModule }), operationId: parsed.operationId }));
    },
    publishDictionary: async (input) => {
      const parsed = command(input, ["dictionaryId", "expectedRevision"]);
      const dictionaryId = id(parsed.values.dictionaryId);
      const expectedRevision = version(parsed.values.expectedRevision);
      await authorizeBeforeLookup(parsed, "configuration.dictionary.publish", "configuration:publish", dictionaryId);
      let draft;
      try {
        draft = await store.findDictionaryDraft(dictionaryId);
      } catch (error) {
        throw new BusinessConfigurationError("configuration_unavailable", { cause: error, retryable: true });
      }
      if (!draft) throw new BusinessConfigurationError("configuration_not_found");
      return mutate(parsed, "configuration.dictionary.publish", "configuration:publish", dictionaryId, draft.ownerModule, () => store.publishDictionary({ dictionaryId, event: event("configuration.dictionary.published", dictionaryId), expectedRevision, fingerprint: hash({ dictionaryId, expectedRevision }), operationId: parsed.operationId, publishedAt: clock().toISOString() }));
    },
    getDictionaryRelease: async (input) => {
      const parsed = exact(input, ["actor", "dictionaryId", "releaseVersion"]);
      const parsedActor = actor(parsed.actor);
      const dictionaryId = id(parsed.dictionaryId);
      const releaseVersion = version(parsed.releaseVersion);
      const auth = await authorize({ action: "configuration:read", actor: parsedActor, resourceId: dictionaryId });
      if (!auth.allowed) throw new BusinessConfigurationError("configuration_denied");
      try {
        const found = await store.findDictionaryRelease(dictionaryId, releaseVersion);
        if (!found) throw new BusinessConfigurationError("configuration_not_found");
        return found;
      } catch (error) {
        if (error instanceof BusinessConfigurationError) throw error;
        throw new BusinessConfigurationError("configuration_unavailable", { cause: error, retryable: true });
      }
    },
    registerParameter: async (input) => {
      const parsed = command(input, ["definition"]);
      const parameterDefinition = definition(parsed.values.definition);
      return mutate(parsed, "configuration.parameter.register", "configuration:manage", parameterDefinition.parameterKey, parameterDefinition.ownerModule, () => store.registerParameter({ definition: parameterDefinition, fingerprint: hash(parameterDefinition), operationId: parsed.operationId }));
    },
    publishParameterValue: async (input) => {
      const parsed = command(input, ["parameterKey", "value"]);
      const parameterKey = id(parsed.values.parameterKey);
      await authorizeBeforeLookup(parsed, "configuration.parameter.publish", "configuration:publish", parameterKey);
      const parameterDefinition = await findDefinition(parameterKey);
      const typedValue = value(parsed.values.value, parameterDefinition.valueType);
      if (!compile(parameterDefinition)(typedValue)) throw new BusinessConfigurationError("configuration_invalid_input");
      return mutate(parsed, "configuration.parameter.publish", "configuration:publish", parameterKey, parameterDefinition.ownerModule, () => store.publishParameterValue({ contentDigest: hash({ value: typedValue }), event: event("configuration.parameter.published", parameterKey), fingerprint: hash({ parameterKey, value: typedValue }), operationId: parsed.operationId, parameterKey, publishedAt: clock().toISOString(), value: typedValue }));
    },
    activateParameter: async (input) => {
      const raw = object(input);
      const fields = ["activationId", "effectiveFrom", "parameterKey", "scope", "valueVersion", ...(Object.hasOwn(raw, "effectiveTo") ? ["effectiveTo"] : [])];
      const parsed = command(input, fields);
      const parameterKey = id(parsed.values.parameterKey);
      await authorizeBeforeLookup(parsed, "configuration.parameter.activate", "configuration:activate", parameterKey);
      const parameterDefinition = await findDefinition(parameterKey);
      const parsedScope = scope(parsed.values.scope);
      const valueVersion = version(parsed.values.valueVersion);
      const activationId = uuid(parsed.values.activationId);
      const effectiveFrom = date(parsed.values.effectiveFrom);
      const effectiveTo = parsed.values.effectiveTo === undefined ? undefined : date(parsed.values.effectiveTo);
      if (!parameterDefinition.allowedScopes.some((allowed) => allowed.scopeType === parsedScope.scopeType) || (effectiveTo !== undefined && effectiveTo <= effectiveFrom)) throw new BusinessConfigurationError("configuration_invalid_input");
      const activation = { activationId, effectiveFrom, ...(effectiveTo === undefined ? {} : { effectiveTo }), parameterKey, scope: parsedScope, valueVersion };
      return mutate(parsed, "configuration.parameter.activate", "configuration:activate", parameterKey, parameterDefinition.ownerModule, () => store.activate({ activation, event: event("configuration.activation.changed", parameterKey), fingerprint: hash(activation), operationId: parsed.operationId }));
    },
    terminateParameterActivation: async (input) => {
      const parsed = command(input, ["activationId", "effectiveTo", "parameterKey", "terminationId"]);
      const parameterKey = id(parsed.values.parameterKey);
      await authorizeBeforeLookup(parsed, "configuration.parameter.activation.terminate", "configuration:activate", parameterKey);
      const parameterDefinition = await findDefinition(parameterKey);
      const activationId = uuid(parsed.values.activationId);
      const terminationId = uuid(parsed.values.terminationId);
      const effectiveTo = date(parsed.values.effectiveTo);
      const occurredAt = clock().toISOString();
      if (effectiveTo < occurredAt) throw new BusinessConfigurationError("configuration_invalid_input");
      const termination = { activationId, effectiveTo, parameterKey, terminationId };
      return mutate(parsed, "configuration.parameter.activation.terminate", "configuration:activate", parameterKey, parameterDefinition.ownerModule, () => store.terminateActivation({ ...termination, event: event("configuration.activation.changed", parameterKey), fingerprint: hash(termination), occurredAt, operationId: parsed.operationId }));
    },
    resolveParameter: async (input) => {
      const parsed = exact(input, ["actor", "at", "parameterKey", "scopes"]);
      if (!Array.isArray(parsed.scopes) || parsed.scopes.length > 20) throw new BusinessConfigurationError("configuration_invalid_input");
      const parsedActor = actor(parsed.actor);
      const at = date(parsed.at);
      const parameterKey = id(parsed.parameterKey);
      const scopes = parsed.scopes.map(scope);
      if (new Set(scopes.map((candidate) => candidate.scopeType)).size !== scopes.length) throw new BusinessConfigurationError("configuration_invalid_input");
      const auth = await authorize({ action: "configuration:read", actor: parsedActor, resourceId: parameterKey });
      if (!auth.allowed) throw new BusinessConfigurationError("configuration_denied");
      const cacheKey = hash({ at, parameterKey, scopes: [...scopes].sort((left, right) => left.scopeType.localeCompare(right.scopeType)) });
      const parameterDefinition = await findDefinition(parameterKey);
      let cached: ResolvedParameter | undefined;
      try {
        cached = cachedResolution(await cache.get(cacheKey), parameterKey, parameterDefinition, scopes, at);
      } catch {
        // PostgreSQL remains the source of truth when the cache is unavailable or corrupt.
      }
      let activations;
      try {
        activations = await store.listEffectiveActivations(parameterKey, scopes, at);
      } catch (error) {
        throw new BusinessConfigurationError("configuration_unavailable", { cause: error, retryable: true });
      }
      const priorities = new Map(parameterDefinition.allowedScopes.map((allowed) => [allowed.scopeType, allowed.priority]));
      const selected = [...activations].sort((left, right) => (priorities.get(right.scope.scopeType) ?? -1) - (priorities.get(left.scope.scopeType) ?? -1))[0];
      let result: ResolvedParameter;
      if (!selected) {
        if (parameterDefinition.missingPolicy !== "use_default" || parameterDefinition.defaultValue === undefined) throw new BusinessConfigurationError("configuration_missing");
        result = { definitionVersion: 1, parameterKey, source: "default", value: parameterDefinition.defaultValue, valueVersion: 0, version: 1 };
      } else {
        let release;
        try {
          release = await store.findParameterValue(parameterKey, selected.valueVersion);
        } catch (error) {
          throw new BusinessConfigurationError("configuration_unavailable", { cause: error, retryable: true });
        }
        if (!release) throw new BusinessConfigurationError("configuration_missing");
        result = { activationId: selected.activationId, definitionVersion: 1, effectiveFrom: selected.effectiveFrom, ...(selected.effectiveTo === undefined ? {} : { effectiveTo: selected.effectiveTo }), parameterKey, scope: selected.scope, source: "activation", value: release.value, valueVersion: release.valueVersion, version: 1 };
      }
      try {
        await cache.set(cacheKey, result);
      } catch {
        // Cache population is best effort; the resolved database fact remains valid.
      }
      return structuredClone(cached !== undefined && hash(cached) === hash(result) ? cached : result);
    },
    handleInvalidation: async (input) => {
      const value = exact(input, ["eventId", "eventType", "occurredAt", "resourceId", "version"]);
      const allowedEvents: readonly ConfigurationInvalidationEvent["eventType"][] = ["configuration.activation.changed", "configuration.dictionary.published", "configuration.parameter.published"];
      if (!allowedEvents.includes(value.eventType as ConfigurationInvalidationEvent["eventType"])) throw new BusinessConfigurationError("configuration_invalid_input");
      const parsed: ConfigurationInvalidationEvent = { eventId: uuid(value.eventId), eventType: value.eventType as ConfigurationInvalidationEvent["eventType"], occurredAt: date(value.occurredAt), resourceId: id(value.resourceId), version: version(value.version, true) };
      try {
        await cache.invalidate(parsed);
      } catch (error) {
        throw new BusinessConfigurationError("configuration_unavailable", { cause: error, retryable: true });
      }
    },
  };
}
