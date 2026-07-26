import { createHash } from "node:crypto";
import { EventingError } from "./errors.js";
import type { EventEnvelope, JobEnvelope, JsonValue, ValidatedMessage } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TYPE = /^([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+)\.v([1-9][0-9]*)$/u;
const IDENTIFIER = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;
const SOURCE = /^urn:ai-crm:[a-z][a-z0-9.-]*$/u;
const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const invalid = (): never => { throw new EventingError("eventing_invalid_input"); };
const record = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const text = (value: unknown, pattern: RegExp, max: number): string => typeof value === "string" && value.length <= max && pattern.test(value) ? value : invalid();
const optional = (value: unknown, pattern: RegExp, max: number): string | undefined => value === undefined ? undefined : text(value, pattern, max);
const exact = (value: Record<string, unknown>, required: readonly string[], optionalKeys: readonly string[]): void => {
  const keys = Object.keys(value);
  if (!required.every((key) => keys.includes(key)) || keys.some((key) => !required.includes(key) && !optionalKeys.includes(key))) invalid();
};
const time = (value: unknown): { value: string; date: Date } => {
  const raw = text(value, TIMESTAMP, 24);
  const date = new Date(raw);
  return !Number.isNaN(date.getTime()) && date.toISOString() === raw ? { value: raw, date } : invalid();
};
const json = (value: unknown, depth = 0): JsonValue => {
  if (depth > 16) invalid();
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : invalid();
  if (Array.isArray(value)) return value.map((item) => json(item, depth + 1));
  const source = record(value);
  if (Object.keys(source).length > 256) invalid();
  return Object.fromEntries(Object.entries(source).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => {
    if (key.length < 1 || key.length > 128) invalid();
    return [key, json(item, depth + 1)];
  }));
};
const finish = (input: Omit<ValidatedMessage, "serialized" | "payloadSha256">): ValidatedMessage => {
  const serialized = JSON.stringify(input.envelope);
  if (Buffer.byteLength(serialized, "utf8") > 262_144) invalid();
  return Object.freeze({ ...input, serialized, payloadSha256: createHash("sha256").update(serialized).digest("hex") });
};
const traces = (value: Record<string, unknown>) => ({
  traceparent: optional(value["traceparent"], TRACEPARENT, 55),
  tracestate: optional(value["tracestate"], /^[\x20-\x7e]+$/u, 512),
});

export function validateEventEnvelope(input: unknown): ValidatedMessage {
  const value = record(input);
  exact(value, ["specversion", "id", "source", "type", "time", "datacontenttype", "dataschema", "correlationid", "data"], ["subject", "causationid", "traceparent", "tracestate"]);
  if (value["specversion"] !== "1.0" || value["datacontenttype"] !== "application/json") invalid();
  const messageId = text(value["id"], UUID, 36);
  const typed = text(value["type"], TYPE, 160);
  const match = TYPE.exec(typed) ?? invalid();
  const occurred = time(value["time"]);
  const correlationId = text(value["correlationid"], UUID, 36);
  const causationId = optional(value["causationid"], UUID, 36);
  const trace = traces(value);
  const envelope: EventEnvelope = {
    specversion: "1.0", id: messageId, source: text(value["source"], SOURCE, 256), type: typed,
    time: occurred.value, datacontenttype: "application/json", dataschema: text(value["dataschema"], /^urn:ai-crm:(events|models):[a-z0-9:-]+:v[1-9][0-9]*$/u, 512),
    correlationid: correlationId, data: json(value["data"]),
    ...(value["subject"] === undefined ? {} : { subject: text(value["subject"], /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,254}$/u, 255) }),
    ...(causationId === undefined ? {} : { causationid: causationId }), ...(trace.traceparent === undefined ? {} : { traceparent: trace.traceparent }),
    ...(trace.tracestate === undefined ? {} : { tracestate: trace.tracestate }),
  };
  return finish({ envelope, messageId, messageKind: "event", messageType: typed, messageVersion: Number(match[2]), producer: envelope.source, occurredAt: occurred.date, availableAt: occurred.date, correlationId, ...(causationId === undefined ? {} : { causationId }), ...(trace.traceparent === undefined ? {} : { traceparent: trace.traceparent }), ...(trace.tracestate === undefined ? {} : { tracestate: trace.tracestate }) });
}

export function validateJobEnvelope(input: unknown): ValidatedMessage {
  const value = record(input);
  exact(value, ["jobId", "jobType", "jobVersion", "source", "idempotencyKey", "requestedAt", "correlationId", "policy", "payload"], ["notBefore", "causationId", "traceparent", "tracestate"]);
  const requested = time(value["requestedAt"]); const available = value["notBefore"] === undefined ? requested : time(value["notBefore"]);
  if (available.date < requested.date) invalid();
  const version = value["jobVersion"]; const policy = record(value["policy"]); const maxAttempts = policy["maxAttempts"]; const backoff = policy["backoffSeconds"]; const timeout = policy["timeoutMs"];
  exact(policy, ["maxAttempts", "backoffSeconds", "timeoutMs", "failureDisposition"], []);
  if (!Number.isInteger(version) || (version as number) < 1 || (version as number) > 1000 || !Number.isInteger(maxAttempts) || (maxAttempts as number) < 1 || (maxAttempts as number) > 16 || !Array.isArray(backoff) || backoff.length !== (maxAttempts as number) - 1 || backoff.some((item) => !Number.isInteger(item) || item < 1 || item > 86400) || !Number.isInteger(timeout) || (timeout as number) < 100 || (timeout as number) > 900000 || policy["failureDisposition"] !== "isolate") invalid();
  const messageId = text(value["jobId"], UUID, 36); const correlationId = text(value["correlationId"], UUID, 36); const causationId = optional(value["causationId"], UUID, 36); const trace = traces(value);
  const envelope: JobEnvelope = { jobId: messageId, jobType: text(value["jobType"], IDENTIFIER, 128), jobVersion: version as number, source: text(value["source"], SOURCE, 256), idempotencyKey: text(value["idempotencyKey"], /^[A-Za-z0-9][A-Za-z0-9._:@/-]{7,127}$/u, 128), requestedAt: requested.value, ...(value["notBefore"] === undefined ? {} : { notBefore: available.value }), correlationId, ...(causationId === undefined ? {} : { causationId }), ...(trace.traceparent === undefined ? {} : { traceparent: trace.traceparent }), ...(trace.tracestate === undefined ? {} : { tracestate: trace.tracestate }), policy: { maxAttempts: maxAttempts as number, backoffSeconds: backoff as number[], timeoutMs: timeout as number, failureDisposition: "isolate" }, payload: json(value["payload"]) };
  return finish({ envelope, messageId, messageKind: "job", messageType: envelope.jobType, messageVersion: envelope.jobVersion, producer: envelope.source, occurredAt: requested.date, availableAt: available.date, correlationId, ...(causationId === undefined ? {} : { causationId }), ...(trace.traceparent === undefined ? {} : { traceparent: trace.traceparent }), ...(trace.tracestate === undefined ? {} : { tracestate: trace.tracestate }) });
}

export const validateMessageEnvelope = (input: unknown): ValidatedMessage => typeof input === "object" && input !== null && "specversion" in input ? validateEventEnvelope(input) : validateJobEnvelope(input);
export const validateConsumerName = (value: unknown): string => text(value, IDENTIFIER, 128);
export const validateReason = (value: unknown): string => text(value, /^[A-Za-z0-9][A-Za-z0-9 ._:@/()-]{7,511}$/u, 512);
export const validateUuid = (value: unknown): string => text(value, UUID, 36);
