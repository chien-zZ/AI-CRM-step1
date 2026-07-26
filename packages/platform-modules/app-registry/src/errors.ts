export type AppRegistryErrorCode = "app_registry_denied" | "app_registry_invalid_input" | "app_registry_operation_conflict" | "app_registry_target_unavailable" | "app_registry_unavailable";
export class AppRegistryError extends Error {
  readonly code: AppRegistryErrorCode;
  readonly retryable: boolean;
  constructor(code: AppRegistryErrorCode, options?: { readonly cause?: unknown; readonly retryable?: boolean }) {
    super(code, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppRegistryError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}
