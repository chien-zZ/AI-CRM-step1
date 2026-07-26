export const INTEGRATION_ERROR_CATEGORIES = [
  "authentication",
  "cancelled",
  "circuit_open",
  "concurrency_limited",
  "connection",
  "internal",
  "invalid_input",
  "invalid_response",
  "rate_limited",
  "rejected",
  "replay_detected",
  "signature_invalid",
  "timeout",
  "upstream_unavailable",
] as const;

export type IntegrationErrorCategory = typeof INTEGRATION_ERROR_CATEGORIES[number];

export class IntegrationRuntimeError extends Error {
  readonly category: IntegrationErrorCategory;
  readonly retryable: boolean;

  constructor(
    category: IntegrationErrorCategory,
    options: { readonly cause?: unknown; readonly retryable?: boolean } = {},
  ) {
    super(`INTEGRATION_${category.toUpperCase()}`, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "IntegrationRuntimeError";
    this.category = category;
    this.retryable = options.retryable ?? false;
  }
}
