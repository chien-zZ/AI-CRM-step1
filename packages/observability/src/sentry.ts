import * as Sentry from "@sentry/node";

import { sanitizeTelemetry, type SafeTelemetryValue } from "./sanitize.js";

export interface ErrorReport {
  readonly operation: string;
  readonly errorCode: string;
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly traceId?: string;
}

export interface SafeErrorEvent {
  readonly operation: string;
  readonly errorCode: string;
  readonly fields?: SafeTelemetryValue;
  readonly traceId?: string;
}

export interface ErrorEventClient {
  capture(event: SafeErrorEvent): void | Promise<void>;
  flush(timeoutMilliseconds: number): boolean | Promise<boolean>;
}

export interface ErrorReporter {
  capture(report: ErrorReport): void;
  flush(timeoutMilliseconds?: number): Promise<boolean>;
}

export interface SentryReporterOptions {
  readonly enabled: boolean;
  readonly environment: string;
  readonly release: string;
  readonly dsn?: string;
  readonly client?: ErrorEventClient;
}

const STABLE_NAME = /^[a-z][a-z0-9_.-]{0,127}$/u;
const RELEASE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u;
const TRACE_ID = /^(?!0{32}$)[0-9a-f]{32}$/u;

function safeName(value: string): string {
  return STABLE_NAME.test(value) ? value : "invalid.telemetry.name";
}

function safeRelease(value: string): string {
  return RELEASE.test(value) ? value : "invalid.telemetry.release";
}

function safeTraceId(value: string): string {
  return TRACE_ID.test(value) ? value : "invalid.telemetry.trace_id";
}

function createSdkClient(options: SentryReporterOptions): ErrorEventClient {
  Sentry.init({
    beforeBreadcrumb: () => null,
    beforeSend(event) {
      const errorCode = event.tags?.["error_code"];
      const traceId = event.tags?.["trace_id"];
      return {
        type: event.type,
        environment: safeName(options.environment),
        release: safeRelease(options.release),
        ...(event.event_id === undefined ? {} : { event_id: event.event_id }),
        ...(event.fingerprint === undefined
          ? {}
          : { fingerprint: event.fingerprint.slice(0, 4).map(safeName) }),
        ...(event.level === undefined ? {} : { level: event.level }),
        ...(event.message === undefined ? {} : { message: safeName(event.message) }),
        tags: {
          error_code: typeof errorCode === "string" ? safeName(errorCode) : "unavailable",
          trace_id: typeof traceId === "string" ? safeTraceId(traceId) : "unavailable",
        },
      };
    },
    defaultIntegrations: false,
    dsn: options.dsn,
    enabled: options.enabled,
    environment: safeName(options.environment),
    release: safeRelease(options.release),
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
  return {
    capture(event) {
      const safeContext = event.fields !== null &&
        typeof event.fields === "object" &&
        !Array.isArray(event.fields)
        ? Object.fromEntries(Object.entries(event.fields))
        : { value: event.fields };
      Sentry.captureEvent({
        ...(event.fields === undefined ? {} : { contexts: { safe: safeContext } }),
        fingerprint: [event.errorCode, event.operation],
        level: "error",
        message: event.operation,
        tags: {
          error_code: event.errorCode,
          trace_id: event.traceId ?? "unavailable",
        },
      });
    },
    flush(timeoutMilliseconds) {
      return Sentry.flush(timeoutMilliseconds);
    },
  };
}

export function createErrorReporter(options: SentryReporterOptions): ErrorReporter {
  if (!options.enabled) {
    return Object.freeze({
      capture() {},
      flush: () => Promise.resolve(true),
    });
  }
  const client = options.client ?? createSdkClient(options);
  return Object.freeze({
    capture(report: ErrorReport) {
      const event: SafeErrorEvent = {
        errorCode: safeName(report.errorCode),
        operation: safeName(report.operation),
        ...(report.fields === undefined
          ? {}
          : { fields: sanitizeTelemetry(report.fields) }),
        ...(report.traceId === undefined
          ? {}
          : { traceId: safeTraceId(report.traceId) }),
      };
      try {
        void Promise.resolve(client.capture(event)).catch(() => undefined);
      } catch {
        // Telemetry delivery must never change application behavior.
      }
    },
    async flush(timeoutMilliseconds = 2_000) {
      try {
        return await client.flush(Math.max(0, Math.min(timeoutMilliseconds, 10_000)));
      } catch {
        return false;
      }
    },
  });
}
