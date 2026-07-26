import { createHash } from "node:crypto";
import { TaskCenterError } from "./errors.js";
import type { TaskActor, TaskLifecycleEvent, TaskProjectionKey } from "./types.js";

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,254}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const invalid = (): never => { throw new TaskCenterError("TASK_INPUT_INVALID"); };
export const validateId = (value: unknown): string => typeof value === "string" && ID.test(value) ? value : invalid();
export const validateUuid = (value: unknown): string => typeof value === "string" && UUID.test(value) ? value : invalid();
export const validateKey = (value: TaskProjectionKey): TaskProjectionKey => ({ sourceType: validateId(value.sourceType), sourceTaskId: validateId(value.sourceTaskId) });
export const validateActor = (value: TaskActor): TaskActor => ({ principalId: validateId(value.principalId) });
export const validateEvent = (value: TaskLifecycleEvent): TaskLifecycleEvent => {
  const key = validateKey(value);
  if (!Number.isSafeInteger(value.sourceVersion) || value.sourceVersion < 1 || !["open", "completed", "cancelled"].includes(value.status)) invalid();
  const occurredAt = new Date(value.occurredAt);
  if (!Number.isFinite(occurredAt.valueOf()) || occurredAt.toISOString() !== value.occurredAt) invalid();
  if (value.dueAt !== undefined && !Number.isFinite(new Date(value.dueAt).valueOf())) invalid();
  return { ...value, ...key, eventId: validateUuid(value.eventId), deepLink: { appId: validateId(value.deepLink.appId), routeId: validateId(value.deepLink.routeId) }, ...(value.assigneeReference === undefined ? {} : { assigneeReference: validateId(value.assigneeReference) }), ...(value.candidateScopeReference === undefined ? {} : { candidateScopeReference: validateId(value.candidateScopeReference) }) };
};
export const fingerprint = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
