import {
  EventingError,
  type EventingCore,
  type MessageHandler,
  type ValidatedMessage,
} from "@ai-crm/platform-eventing-outbox";
import type { TaskLifecycleEvent } from "@ai-crm/platform-task-center";
import { createRabbitInboxHandler, type RabbitConsumerAdapter } from "./handlers.js";
import type { WorkerHandler } from "./index.js";
import {
  classifyTaskProjectionError,
  taskProjectionBindingId,
  taskProjectionConsumerId,
  taskProjectionRuntimePolicy,
} from "./task-projection-policy.js";

const EVENT_TYPE = "task-center.projection-lifecycle.v1" as const;
const EVENT_SCHEMA = "urn:ai-crm:events:task-projection-lifecycle:v1" as const;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,254}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const UTC_RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/u;
const REQUIRED_KEYS = Object.freeze(["deepLink", "eventId", "occurredAt", "sourceTaskId", "sourceType", "sourceVersion", "status"] as const);
const OPTIONAL_KEYS = Object.freeze(["assigneeReference", "candidateScopeReference", "dueAt"] as const);

export interface AbortableTaskProjectionApplyPort {
  readonly apply: (event: TaskLifecycleEvent, signal: AbortSignal) => Promise<unknown>;
}

function invalid(): never {
  throw new EventingError("eventing_invalid_input");
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : invalid();
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const keys = Object.keys(value);
  if (!required.every((key) => keys.includes(key)) || keys.some((key) => !required.includes(key) && !optional.includes(key))) invalid();
}

function identifier(value: unknown): string {
  return typeof value === "string" && ID.test(value) ? value : invalid();
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") return invalid();
  const match = UTC_RFC3339.exec(value);
  if (!match) return invalid();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maximumDay = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return maximumDay !== undefined && day >= 1 && day <= maximumDay && hour <= 23 && minute <= 59 && second <= 59 ? value : invalid();
}

function optionalIdentifier(value: unknown): string | undefined {
  return value === undefined ? undefined : identifier(value);
}

function parseTaskLifecycleEvent(message: ValidatedMessage): TaskLifecycleEvent {
  if (message.messageKind !== "event" || message.messageType !== EVENT_TYPE || message.messageVersion !== 1) invalid();
  const envelope = record(message.envelope);
  if (envelope["dataschema"] !== EVENT_SCHEMA) invalid();
  const value = record(envelope["data"]);
  exactKeys(value, REQUIRED_KEYS, OPTIONAL_KEYS);
  const deepLink = record(value["deepLink"]);
  exactKeys(deepLink, ["appId", "routeId"]);
  const eventId = value["eventId"];
  const sourceVersion = value["sourceVersion"];
  const status = value["status"];
  if (typeof eventId !== "string" || !UUID.test(eventId)) invalid();
  if (!Number.isSafeInteger(sourceVersion) || (sourceVersion as number) < 1) invalid();
  if (status !== "open" && status !== "completed" && status !== "cancelled") invalid();
  const assigneeReference = optionalIdentifier(value["assigneeReference"]);
  const candidateScopeReference = optionalIdentifier(value["candidateScopeReference"]);
  const dueAt = value["dueAt"] === undefined ? undefined : timestamp(value["dueAt"]);
  return Object.freeze({
    eventId,
    sourceType: identifier(value["sourceType"]),
    sourceTaskId: identifier(value["sourceTaskId"]),
    sourceVersion: sourceVersion as number,
    occurredAt: timestamp(value["occurredAt"]),
    status,
    deepLink: Object.freeze({ appId: identifier(deepLink["appId"]), routeId: identifier(deepLink["routeId"]) }),
    ...(assigneeReference === undefined ? {} : { assigneeReference }),
    ...(candidateScopeReference === undefined ? {} : { candidateScopeReference }),
    ...(dueAt === undefined ? {} : { dueAt }),
  });
}

export function createTaskProjectionMessageHandler(port: AbortableTaskProjectionApplyPort): MessageHandler {
  if (typeof port.apply !== "function") throw new Error("worker_task_projection_port_invalid");
  return Object.freeze({
    kind: "event",
    messageType: EVENT_TYPE,
    messageVersion: 1,
    async handle(message: ValidatedMessage, signal: AbortSignal): Promise<void> {
      await port.apply(parseTaskLifecycleEvent(message), signal);
    },
  });
}

export function createTaskProjectionConsumerHandler(
  core: EventingCore,
  adapter: RabbitConsumerAdapter,
  port: AbortableTaskProjectionApplyPort,
): WorkerHandler {
  if (adapter.prefetch !== taskProjectionRuntimePolicy.prefetch || adapter.concurrency !== taskProjectionRuntimePolicy.concurrency) {
    throw new Error("worker_task_projection_runtime_policy_mismatch");
  }
  return createRabbitInboxHandler(core, adapter, [Object.freeze({
    bindingId: taskProjectionBindingId,
    classify: classifyTaskProjectionError,
    consumer: taskProjectionConsumerId,
    eventPolicy: taskProjectionRuntimePolicy,
    handler: createTaskProjectionMessageHandler(port),
  })]);
}
