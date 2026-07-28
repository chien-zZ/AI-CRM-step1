export type JsonObject = Readonly<Record<string, unknown>>;

export interface FormActor { readonly actorId: string; readonly actorType: "authenticated_subject" | "system"; readonly assignmentId?: string }
export interface FormUiField { readonly component: "date" | "input" | "number" | "select" | "switch" | "textarea"; readonly field: string; readonly order: number; readonly span?: number }
export interface FormUiSchema { readonly fields: readonly FormUiField[]; readonly layout: "grid" | "vertical"; readonly version: 1 }
export interface FormDraft { readonly definitionId: string; readonly jsonSchema: JsonObject; readonly ownerModule: string; readonly revision: number; readonly uiSchema: FormUiSchema; readonly updatedAt: string }
export interface FormRelease extends Omit<FormDraft, "revision" | "updatedAt"> { readonly active: boolean; readonly contentDigest: string; readonly publishedAt: string; readonly releaseVersion: number; readonly version: 1 }
export interface FormDefinitionReference { readonly contentDigest: string; readonly definitionId: string; readonly releaseVersion: number; readonly version: 1 }
export interface FormValidationResult { readonly errors: readonly { readonly instancePath: string; readonly keyword: string }[]; readonly reference: FormDefinitionReference; readonly valid: boolean }

export interface FormCommandMetadata { readonly actor: FormActor; readonly operationId: string; readonly reason: string; readonly traceId: string }
export interface SaveFormDraftCommand extends FormCommandMetadata { readonly definitionId: string; readonly expectedRevision: number; readonly jsonSchema: JsonObject; readonly ownerModule: string; readonly uiSchema: FormUiSchema }
export interface PublishFormCommand extends FormCommandMetadata { readonly definitionId: string; readonly expectedRevision: number }
export interface SetFormReleaseActiveCommand extends FormCommandMetadata { readonly active: boolean; readonly definitionId: string; readonly releaseVersion: number }

export interface FormAuthorizationRequest { readonly action: "form:manage" | "form:publish" | "form:read" | "form:validate"; readonly actor: FormActor; readonly ownerModule?: string; readonly resourceId: string }
export interface FormAuthorizer { authorize(input: FormAuthorizationRequest): Promise<{ readonly allowed: boolean; readonly decisionId: string }> }
export interface FormAudit { record(input: { readonly action: string; readonly actor: FormActor; readonly authorizationDecisionId: string; readonly operationId: string; readonly reason: string; readonly resourceId: string; readonly result: "attempted" | "denied" | "failed" | "succeeded"; readonly traceId: string }): Promise<void> }

export interface FormSchemaService {
  getRelease(input: { readonly actor: FormActor; readonly definitionId: string; readonly releaseVersion: number }): Promise<FormRelease>;
  publish(command: PublishFormCommand): Promise<{ readonly reference: FormDefinitionReference; readonly replayed: boolean }>;
  saveDraft(command: SaveFormDraftCommand): Promise<{ readonly draft: FormDraft; readonly replayed: boolean }>;
  setReleaseActive(command: SetFormReleaseActiveCommand): Promise<{ readonly replayed: boolean }>;
  validateSubmission(input: { readonly actor: FormActor; readonly data: unknown; readonly definitionId: string; readonly releaseVersion: number }): Promise<FormValidationResult>;
}

export interface FormAuthorizationSubject {
  readonly activeAssignmentIds: readonly string[];
  readonly selectedAssignmentId?: string;
  readonly workforcePersonId: string;
}

export interface FormQueryContext {
  readonly actor: FormActor;
  readonly subject: FormAuthorizationSubject;
  readonly traceId: string;
}

export interface FormQueryAuthorizationRequest {
  readonly action: "read" | "validate";
  readonly actor: FormActor;
  readonly definitionId: string;
  readonly permission: Readonly<{ readonly action: "read" | "validate"; readonly code: string; readonly resource: "platform.form-schema.form-release" }>;
  readonly releaseVersion: number;
  readonly subject: FormAuthorizationSubject;
  readonly traceId: string;
}

export interface FormQueryAuthorizer {
  authorize(request: FormQueryAuthorizationRequest): Promise<{ readonly allowed: boolean; readonly decisionId: string }>;
}

export interface FormSchemaQueryService {
  getRelease(input: { readonly context: FormQueryContext; readonly definitionId: string; readonly releaseVersion: number }): Promise<FormRelease>;
  validateSubmission(input: { readonly context: FormQueryContext; readonly data: unknown; readonly definitionId: string; readonly releaseVersion: number }): Promise<FormValidationResult>;
}

export interface FormOutboxEvent { readonly eventId: string; readonly eventType: "form.release.active_changed" | "form.release.published"; readonly occurredAt: string; readonly payload: Readonly<{ definitionId: string; releaseVersion: number }> }
