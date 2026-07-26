export const packageId = "@ai-crm/platform-integration-runtime" as const;

export {
  IntegrationRuntimeError,
  INTEGRATION_ERROR_CATEGORIES,
  type IntegrationErrorCategory,
} from "./errors.js";
export {
  createDeadlineBudget,
  runWithDeadline,
  type DeadlineBudget,
  type DeadlineLimits,
  type DeadlinePhase,
} from "./deadline.js";
export {
  calculateBackoffMs,
  shouldRetry,
  type RetryPolicy,
} from "./retry.js";
export {
  createConcurrencyLimiter,
  createFixedWindowRateLimiter,
  type ConcurrencyLimiter,
  type RateLimitDecision,
  type RateLimiter,
} from "./limits.js";
export {
  createCircuitBreaker,
  type CircuitBreaker,
  type CircuitBreakerOptions,
  type CircuitState,
} from "./circuit-breaker.js";
export {
  createIntegrationExecutor,
  type IntegrationExecutionContext,
  type IntegrationExecutionObserver,
  type IntegrationExecutionPolicy,
  type IntegrationExecutor,
  type OperationSafety,
} from "./executor.js";
export {
  acceptVerifiedWebhook,
  type AcceptedWebhook,
  type WebhookAcceptanceOptions,
  type WebhookEnvelope,
  type WebhookReplayReservation,
  type WebhookReplayStore,
  type WebhookSignatureVerifier,
} from "./webhook.js";
