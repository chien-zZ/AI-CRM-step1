export type FileCenterErrorCode =
  | "file_center_denied"
  | "file_center_invalid_input"
  | "file_center_not_found"
  | "file_center_not_ready"
  | "file_center_operation_conflict"
  | "file_center_policy_rejected"
  | "file_center_scan_unavailable"
  | "file_center_storage_unavailable";

export class FileCenterError extends Error {
  readonly code: FileCenterErrorCode;
  readonly retryable: boolean;

  constructor(code: FileCenterErrorCode, options: { readonly cause?: unknown; readonly retryable?: boolean } = {}) {
    super(code, { cause: options.cause });
    this.name = "FileCenterError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}
