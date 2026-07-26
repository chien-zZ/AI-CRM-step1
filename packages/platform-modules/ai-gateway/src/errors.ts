export type AiGatewayErrorCode =
  | "ai_adapter_unavailable"
  | "ai_budget_exceeded"
  | "ai_confirmation_denied"
  | "ai_data_policy_rejected"
  | "ai_invalid_input"
  | "ai_operation_conflict"
  | "ai_output_invalid"
  | "ai_proposal_expired"
  | "ai_proposal_unavailable"
  | "ai_use_case_unavailable";

export class AiGatewayError extends Error {
  readonly code: AiGatewayErrorCode;
  readonly retryable: boolean;

  constructor(code: AiGatewayErrorCode, options: { readonly cause?: unknown; readonly retryable?: boolean } = {}) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AiGatewayError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}
