export const packageId="@ai-crm/platform-form-schema" as const;
export {createPostgresFormSchemaCapabilityProbe,type FormSchemaCapabilityProbe,type FormSchemaCapabilityStatus} from "./capability-probe.js";
export {FormSchemaError,type FormSchemaErrorCode} from "./errors.js";
export {createFormSchemaService} from "./service.js";
export {createMemoryFormSchemaStore} from "./memory-store.js";
export {createPostgresFormSchemaStore} from "./postgres-store.js";
export {createPostgresFormSchemaQueryService} from "./query-service.js";
export type {FormPersistenceResult,FormPersistenceRuntime,FormSchemaStore} from "./store.js";
export type {FormActor,FormAudit,FormAuthorizationRequest,FormAuthorizationSubject,FormAuthorizer,FormCommandMetadata,FormDefinitionReference,FormDraft,FormOutboxEvent,FormQueryAuthorizationRequest,FormQueryAuthorizer,FormQueryContext,FormRelease,FormSchemaQueryService,FormSchemaService,FormUiField,FormUiSchema,FormValidationResult,JsonObject,PublishFormCommand,SaveFormDraftCommand,SetFormReleaseActiveCommand} from "./types.js";
