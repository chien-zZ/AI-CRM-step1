export type AuditErrorCode =
  | "audit_access_denied"
  | "audit_authorization_unavailable"
  | "audit_invalid_input"
  | "audit_operation_conflict"
  | "audit_record_not_found"
  | "audit_store_unavailable";

export class AuditError extends Error {
  readonly code: AuditErrorCode;
  readonly retryable: boolean;

  constructor(code: AuditErrorCode, options?: { readonly cause?: unknown; readonly retryable?: boolean }) {
    super(code, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AuditError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}
