import pino from "pino";

import { getCorrelationContext } from "./context.js";
import { sanitizeTelemetry, type SafeTelemetryValue } from "./sanitize.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerIdentity {
  readonly service: string;
  readonly environment: string;
  readonly version: string;
  readonly instanceId: string;
}

export interface LogEvent {
  readonly operation: string;
  readonly outcome: "started" | "succeeded" | "failed" | "rejected" | "degraded";
  readonly errorCode?: string;
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly traceId?: string;
  readonly spanId?: string;
}

export interface ApplicationLogger {
  log(level: LogLevel, event: LogEvent): void;
}

export interface CreateLoggerOptions extends LoggerIdentity {
  readonly level?: LogLevel;
  readonly write?: (line: string) => void;
}

const STABLE_NAME = /^[a-z][a-z0-9_.-]{0,127}$/u;
const RELEASE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u;
const TRACE_ID = /^(?!0{32}$)[0-9a-f]{32}$/u;
const SPAN_ID = /^(?!0{16}$)[0-9a-f]{16}$/u;

function stableName(value: string, field: string): string {
  if (!STABLE_NAME.test(value)) {
    throw new Error(`OBSERVABILITY_INVALID_${field}`);
  }
  return value;
}

function releaseName(value: string): string {
  if (!RELEASE.test(value)) throw new Error("OBSERVABILITY_INVALID_VERSION");
  return value;
}

export function createLogger(options: CreateLoggerOptions): ApplicationLogger {
  const destination = options.write === undefined
    ? undefined
    : { write: options.write };
  const logger = pino(
    {
      base: {
        environment: stableName(options.environment, "ENVIRONMENT"),
        instance_id: stableName(options.instanceId, "INSTANCE_ID"),
        service: stableName(options.service, "SERVICE"),
        version: releaseName(options.version),
      },
      level: options.level ?? "info",
      messageKey: "operation",
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  );

  return Object.freeze({
    log(level: LogLevel, event: LogEvent) {
      const operation = stableName(event.operation, "OPERATION");
      const context = getCorrelationContext();
      const fields: Record<string, SafeTelemetryValue | undefined> = {
        attempt: context.attempt,
        causation_id: context.causationId,
        correlation_id: context.correlationId,
        error_code: event.errorCode === undefined
          ? undefined
          : stableName(event.errorCode, "ERROR_CODE"),
        fields: event.fields === undefined ? undefined : sanitizeTelemetry(event.fields),
        message_id: context.messageId,
        outcome: event.outcome,
        request_id: context.requestId,
        span_id: event.spanId !== undefined && SPAN_ID.test(event.spanId) ? event.spanId : undefined,
        trace_id: event.traceId !== undefined && TRACE_ID.test(event.traceId) ? event.traceId : undefined,
      };
      logger[level](fields, operation);
    },
  });
}
