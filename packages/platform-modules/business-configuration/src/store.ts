import type { ConfigurationInvalidationEvent, DictionaryDraft, DictionaryRelease, ParameterActivation, ParameterActivationTermination, ParameterDefinition, ParameterScope, ParameterValueRelease } from "./types.js";

export interface BusinessConfigurationStore {
  activate(input: { activation: ParameterActivation; event: ConfigurationInvalidationEvent; fingerprint: string; operationId: string }): Promise<{ replayed: boolean }>;
  findDictionaryRelease(id: string, version: number): Promise<DictionaryRelease | undefined>;
  findDictionaryDraft(id: string): Promise<DictionaryDraft | undefined>;
  findParameterDefinition(key: string): Promise<ParameterDefinition | undefined>;
  findParameterValue(key: string, version: number): Promise<ParameterValueRelease | undefined>;
  listEffectiveActivations(key: string, scopes: readonly ParameterScope[], at: string): Promise<readonly ParameterActivation[]>;
  publishDictionary(input: { dictionaryId: string; event: ConfigurationInvalidationEvent; expectedRevision: number; fingerprint: string; operationId: string; publishedAt: string }): Promise<{ release: DictionaryRelease; replayed: boolean }>;
  publishParameterValue(input: { contentDigest: string; event: ConfigurationInvalidationEvent; fingerprint: string; operationId: string; parameterKey: string; publishedAt: string; value: unknown }): Promise<{ release: ParameterValueRelease; replayed: boolean }>;
  registerParameter(input: { definition: ParameterDefinition; fingerprint: string; operationId: string }): Promise<{ definition: ParameterDefinition; replayed: boolean }>;
  saveDictionaryDraft(input: { draft: Omit<DictionaryDraft, "revision">; expectedRevision: number; fingerprint: string; operationId: string }): Promise<{ draft: DictionaryDraft; replayed: boolean }>;
  terminateActivation(input: { activationId: string; effectiveTo: string; event: ConfigurationInvalidationEvent; fingerprint: string; occurredAt: string; operationId: string; parameterKey: string; terminationId: string }): Promise<{ replayed: boolean; termination: ParameterActivationTermination }>;
}
export interface ConfigurationPersistenceResult<Row> { readonly rowCount: number; readonly rows: readonly Row[] }
export interface ConfigurationPersistenceRuntime { execute<Row = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<ConfigurationPersistenceResult<Row>>; withTransaction<T>(work: () => Promise<T>): Promise<T> }
