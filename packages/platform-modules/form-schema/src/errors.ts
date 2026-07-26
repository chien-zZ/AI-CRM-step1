export type FormSchemaErrorCode = "form_denied" | "form_invalid_input" | "form_not_found" | "form_operation_conflict" | "form_schema_rejected" | "form_unavailable";
export class FormSchemaError extends Error {
  readonly code: FormSchemaErrorCode;
  readonly retryable: boolean;
  constructor(code: FormSchemaErrorCode, options: { readonly cause?: unknown; readonly retryable?: boolean } = {}) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "FormSchemaError"; this.code = code; this.retryable = options.retryable ?? false;
  }
}
