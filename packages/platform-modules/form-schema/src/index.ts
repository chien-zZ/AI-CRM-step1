export const packageId="@ai-crm/platform-form-schema" as const;
export {FormSchemaError,type FormSchemaErrorCode} from "./errors.js";
export {createFormSchemaService} from "./service.js";
export {createMemoryFormSchemaStore} from "./memory-store.js";
export {createPostgresFormSchemaStore} from "./postgres-store.js";
export type {FormPersistenceResult,FormPersistenceRuntime,FormSchemaStore} from "./store.js";
export type {FormActor,FormAudit,FormAuthorizationRequest,FormAuthorizer,FormCommandMetadata,FormDefinitionReference,FormDraft,FormOutboxEvent,FormRelease,FormSchemaService,FormUiField,FormUiSchema,FormValidationResult,JsonObject,PublishFormCommand,SaveFormDraftCommand,SetFormReleaseActiveCommand} from "./types.js";
