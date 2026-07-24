import { randomBytes } from "node:crypto";

import {
  ROOT_CONTEXT,
  isSpanContextValid,
  trace,
  type Context,
  type SpanContext,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";

export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: number;
}

const propagator = new W3CTraceContextPropagator();
const getter = {
  get(carrier: Readonly<Record<string, string | undefined>>, key: string) {
    return carrier[key.toLowerCase()];
  },
  keys(carrier: Readonly<Record<string, string | undefined>>) {
    return Object.keys(carrier);
  },
};
const setter = {
  set(carrier: Record<string, string>, key: string, value: string) {
    carrier[key] = value;
  },
};

function randomHex(bytes: number): string {
  let value = randomBytes(bytes).toString("hex");
  while (/^0+$/u.test(value)) {
    value = randomBytes(bytes).toString("hex");
  }
  return value;
}

function localSpanContext(parent?: SpanContext): SpanContext {
  return {
    isRemote: false,
    spanId: randomHex(8),
    traceFlags: parent?.traceFlags ?? 1,
    traceId: parent?.traceId ?? randomHex(16),
  };
}

function toProjectContext(context: Context): TraceContext {
  const spanContext = trace.getSpanContext(context);
  if (spanContext === undefined || !isSpanContextValid(spanContext)) {
    throw new Error("OBSERVABILITY_TRACE_CONTEXT_INVALID");
  }
  return Object.freeze({
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
    traceId: spanContext.traceId,
  });
}

export function createTraceContext(): TraceContext {
  return toProjectContext(trace.setSpanContext(ROOT_CONTEXT, localSpanContext()));
}

export function extractTraceContext(
  headers: Readonly<Record<string, string | undefined>>,
): TraceContext {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const extracted = propagator.extract(ROOT_CONTEXT, normalized, getter);
  const parent = trace.getSpanContext(extracted);
  const spanContext = parent !== undefined && isSpanContextValid(parent)
    ? localSpanContext(parent)
    : localSpanContext();
  return toProjectContext(trace.setSpanContext(ROOT_CONTEXT, spanContext));
}

export function createChildTraceContext(parent: TraceContext): TraceContext {
  const parentSpan: SpanContext = {
    isRemote: false,
    spanId: parent.spanId,
    traceFlags: parent.traceFlags,
    traceId: parent.traceId,
  };
  const spanContext = isSpanContextValid(parentSpan)
    ? localSpanContext(parentSpan)
    : localSpanContext();
  return toProjectContext(trace.setSpanContext(ROOT_CONTEXT, spanContext));
}

export function injectTraceContext(context: TraceContext): Readonly<Record<string, string>> {
  const spanContext: SpanContext = {
    isRemote: false,
    spanId: context.spanId,
    traceFlags: context.traceFlags,
    traceId: context.traceId,
  };
  if (!isSpanContextValid(spanContext)) {
    return Object.freeze({});
  }
  const carrier: Record<string, string> = {};
  propagator.inject(trace.setSpanContext(ROOT_CONTEXT, spanContext), carrier, setter);
  return Object.freeze(carrier);
}
