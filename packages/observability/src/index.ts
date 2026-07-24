export const packageId = "@ai-crm/observability" as const;

export {
  getCorrelationContext,
  normalizeCorrelationContext,
  runWithCorrelationContext,
  type CorrelationContext,
} from "./context.js";
export {
  evaluateHealth,
  type HealthCheckKind,
  type HealthDependency,
  type HealthResult,
} from "./health.js";
export {
  createLogger,
  type ApplicationLogger,
  type CreateLoggerOptions,
  type LogEvent,
  type LoggerIdentity,
  type LogLevel,
} from "./logger.js";
export {
  sanitizeTelemetry,
  type SafeTelemetryValue,
  type SanitizeOptions,
  type TelemetryLimits,
} from "./sanitize.js";
export {
  createErrorReporter,
  type ErrorEventClient,
  type ErrorReport,
  type ErrorReporter,
  type SafeErrorEvent,
  type SentryReporterOptions,
} from "./sentry.js";
export {
  createChildTraceContext,
  createTraceContext,
  extractTraceContext,
  injectTraceContext,
  type TraceContext,
} from "./trace.js";
