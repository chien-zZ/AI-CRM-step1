export type ConfigurationValue = boolean | number | string;
export interface ConfigurationActor { readonly actorId: string; readonly actorType: "authenticated_subject" | "system"; readonly assignmentId?: string }
export interface DictionaryItem { readonly code: string; readonly enabled: boolean; readonly label: string; readonly order: number }
export interface DictionaryDraft { readonly dictionaryId: string; readonly items: readonly DictionaryItem[]; readonly ownerModule: string; readonly revision: number; readonly updatedAt: string }
export interface DictionaryRelease extends Omit<DictionaryDraft, "revision" | "updatedAt"> { readonly contentDigest: string; readonly publishedAt: string; readonly releaseVersion: number; readonly version: 1 }
export interface ParameterScopeDefinition { readonly priority: number; readonly scopeType: string }
export interface ParameterDefinition { readonly allowedScopes: readonly ParameterScopeDefinition[]; readonly defaultValue?: ConfigurationValue; readonly definitionVersion: 1; readonly missingPolicy: "fail_closed" | "use_default"; readonly ownerModule: string; readonly parameterKey: string; readonly valueSchema: Readonly<Record<string, unknown>>; readonly valueType: "boolean" | "integer" | "number" | "string" }
export interface ParameterValueRelease { readonly contentDigest: string; readonly parameterKey: string; readonly publishedAt: string; readonly value: ConfigurationValue; readonly valueVersion: number; readonly version: 1 }
export interface ParameterScope { readonly scopeReference: string; readonly scopeType: string }
export interface ParameterActivation { readonly activationId: string; readonly effectiveFrom: string; readonly effectiveTo?: string; readonly parameterKey: string; readonly scope: ParameterScope; readonly valueVersion: number }
export interface ParameterActivationTermination { readonly activationId: string; readonly effectiveTo: string; readonly occurredAt: string; readonly parameterKey: string; readonly terminationId: string; readonly version: 1 }
export interface ResolvedParameter { readonly activationId?: string; readonly definitionVersion: 1; readonly effectiveFrom?: string; readonly effectiveTo?: string; readonly parameterKey: string; readonly scope?: ParameterScope; readonly source: "activation" | "default"; readonly value: ConfigurationValue; readonly valueVersion: number; readonly version: 1 }
export interface ConfigurationMetadata { readonly actor: ConfigurationActor; readonly operationId: string; readonly reason: string; readonly traceId: string }
export interface SaveDictionaryDraftCommand extends ConfigurationMetadata { readonly dictionaryId: string; readonly expectedRevision: number; readonly items: readonly DictionaryItem[]; readonly ownerModule: string }
export interface PublishDictionaryCommand extends ConfigurationMetadata { readonly dictionaryId: string; readonly expectedRevision: number }
export interface RegisterParameterCommand extends ConfigurationMetadata { readonly definition: Omit<ParameterDefinition, "definitionVersion"> }
export interface PublishParameterValueCommand extends ConfigurationMetadata { readonly parameterKey: string; readonly value: ConfigurationValue }
export interface ActivateParameterCommand extends ConfigurationMetadata { readonly activationId: string; readonly effectiveFrom: string; readonly effectiveTo?: string; readonly parameterKey: string; readonly scope: ParameterScope; readonly valueVersion: number }
export interface TerminateParameterActivationCommand extends ConfigurationMetadata { readonly activationId: string; readonly effectiveTo: string; readonly parameterKey: string; readonly terminationId: string }
export interface ConfigurationAuthorizationRequest { readonly action: "configuration:activate" | "configuration:manage" | "configuration:publish" | "configuration:read"; readonly actor: ConfigurationActor; readonly ownerModule?: string; readonly resourceId: string }
export interface ConfigurationAuthorizer { authorize(input: ConfigurationAuthorizationRequest): Promise<{ readonly allowed: boolean; readonly decisionId: string }> }
export interface ConfigurationAudit { record(input: { readonly action: string; readonly actor: ConfigurationActor; readonly authorizationDecisionId: string; readonly operationId: string; readonly reason: string; readonly resourceId: string; readonly result: "attempted" | "denied" | "failed" | "succeeded"; readonly traceId: string }): Promise<void> }
export interface ConfigurationInvalidationEvent { readonly eventId: string; readonly eventType: "configuration.activation.changed" | "configuration.dictionary.published" | "configuration.parameter.published"; readonly occurredAt: string; readonly resourceId: string; readonly version: number }
export interface ConfigurationCache { get(key: string): Promise<ResolvedParameter | undefined>; invalidate(event: ConfigurationInvalidationEvent): Promise<void>; set(key: string, value: ResolvedParameter): Promise<void> }
export interface BusinessConfigurationService {
  activateParameter(command: ActivateParameterCommand): Promise<{ readonly replayed: boolean }>;
  getDictionaryRelease(input: { readonly actor: ConfigurationActor; readonly dictionaryId: string; readonly releaseVersion: number }): Promise<DictionaryRelease>;
  handleInvalidation(event: ConfigurationInvalidationEvent): Promise<void>;
  publishDictionary(command: PublishDictionaryCommand): Promise<{ readonly release: DictionaryRelease; readonly replayed: boolean }>;
  publishParameterValue(command: PublishParameterValueCommand): Promise<{ readonly release: ParameterValueRelease; readonly replayed: boolean }>;
  registerParameter(command: RegisterParameterCommand): Promise<{ readonly definition: ParameterDefinition; readonly replayed: boolean }>;
  resolveParameter(input: { readonly actor: ConfigurationActor; readonly at: string; readonly parameterKey: string; readonly scopes: readonly ParameterScope[] }): Promise<ResolvedParameter>;
  saveDictionaryDraft(command: SaveDictionaryDraftCommand): Promise<{ readonly draft: DictionaryDraft; readonly replayed: boolean }>;
  terminateParameterActivation(command: TerminateParameterActivationCommand): Promise<{ readonly replayed: boolean; readonly termination: ParameterActivationTermination }>;
}
