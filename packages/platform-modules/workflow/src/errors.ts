export const WORKFLOW_ERROR_CODES = [
  "WORKFLOW_AUDIT_FAILED", "WORKFLOW_AUTHORIZATION_FAILED", "WORKFLOW_CONFLICT",
  "WORKFLOW_DEFINITION_NOT_FOUND", "WORKFLOW_ENGINE_PROTOCOL_ERROR", "WORKFLOW_ENGINE_REJECTED",
  "WORKFLOW_ENGINE_TIMEOUT", "WORKFLOW_ENGINE_UNAVAILABLE", "WORKFLOW_EVENT_PUBLICATION_FAILED",
  "WORKFLOW_IDEMPOTENCY_CONFLICT", "WORKFLOW_INSTANCE_NOT_FOUND", "WORKFLOW_INVALID_INPUT",
  "WORKFLOW_OPERATION_DENIED", "WORKFLOW_TASK_CANCELLED", "WORKFLOW_TASK_COMPLETED",
  "WORKFLOW_RECONCILIATION_REQUIRED", "WORKFLOW_TASK_EXPIRED", "WORKFLOW_TASK_NOT_FOUND", "WORKFLOW_UNKNOWN_DEFINITION_VERSION",
] as const;

export type WorkflowErrorCode = typeof WORKFLOW_ERROR_CODES[number];

export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;
  readonly retryable: boolean;

  constructor(code: WorkflowErrorCode, options: { readonly cause?: unknown; readonly retryable?: boolean } = {}) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "WorkflowError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}
