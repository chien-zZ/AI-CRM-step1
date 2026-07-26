export const TASK_CENTER_ERROR_CODES = [
  "TASK_AUDIT_FAILED", "TASK_AUTHORIZATION_FAILED", "TASK_COMMAND_CONFLICT", "TASK_COMMAND_IN_PROGRESS", "TASK_INPUT_INVALID",
  "TASK_NOT_FOUND", "TASK_OPERATION_DENIED", "TASK_SOURCE_UNAVAILABLE", "TASK_STORAGE_UNAVAILABLE",
] as const;
export type TaskCenterErrorCode = (typeof TASK_CENTER_ERROR_CODES)[number];
export class TaskCenterError extends Error {
  public constructor(public readonly code: TaskCenterErrorCode, options: { readonly cause?: unknown; readonly retryable?: boolean } = {}) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TaskCenterError";
    this.retryable = options.retryable ?? false;
  }
  public readonly retryable: boolean;
}
