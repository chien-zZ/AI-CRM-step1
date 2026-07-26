import { createHash } from "node:crypto";
import { TaskCenterError } from "./errors.js";
import type { TaskActor, TaskCommandResult, TaskLifecycleEvent, TaskProjectionKey } from "./types.js";

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,254}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const UTC_RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/u;
const invalid = (): never => { throw new TaskCenterError("TASK_INPUT_INVALID"); };
export const validateId = (value: unknown): string => typeof value === "string" && ID.test(value) ? value : invalid();
export const validateUuid = (value: unknown): string => typeof value === "string" && UUID.test(value) ? value : invalid();
export const validateKey = (value: TaskProjectionKey): TaskProjectionKey => ({ sourceType: validateId(value.sourceType), sourceTaskId: validateId(value.sourceTaskId) });
export const validateActor = (value: TaskActor): TaskActor => ({ principalId: validateId(value.principalId) });
export const validateTimestamp = (value: unknown): string => {
  if (typeof value !== "string") return invalid();
  const match = UTC_RFC3339.exec(value);
  if (!match) return invalid();
  const year=Number(match[1]);const month=Number(match[2]);const day=Number(match[3]);const hour=Number(match[4]);const minute=Number(match[5]);const second=Number(match[6]);
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const maximumDay=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1];
  return maximumDay!==undefined&&day>=1&&day<=maximumDay&&hour<=23&&minute<=59&&second<=59 ? value : invalid();
};
export const validateEvent = (value: TaskLifecycleEvent): TaskLifecycleEvent => {
  const key = validateKey(value);
  if (!Number.isSafeInteger(value.sourceVersion) || value.sourceVersion < 1 || !["open", "completed", "cancelled"].includes(value.status)) invalid();
  const occurredAt = validateTimestamp(value.occurredAt);
  const dueAt = value.dueAt === undefined ? undefined : validateTimestamp(value.dueAt);
  return { ...value, ...key, occurredAt, eventId: validateUuid(value.eventId), deepLink: { appId: validateId(value.deepLink.appId), routeId: validateId(value.deepLink.routeId) }, ...(value.assigneeReference === undefined ? {} : { assigneeReference: validateId(value.assigneeReference) }), ...(value.candidateScopeReference === undefined ? {} : { candidateScopeReference: validateId(value.candidateScopeReference) }), ...(dueAt === undefined ? {} : { dueAt }) };
};
const canonicalize = (value: unknown, ancestors: ReadonlySet<object>): unknown => {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    if (ancestors.has(value)) invalid();
    const next = new Set(ancestors).add(value);
    return value.map((item) => item === undefined || typeof item === "function" || typeof item === "symbol" ? null : canonicalize(item,next));
  }
  if (typeof value === "object") {
    if (ancestors.has(value)) invalid();
    const next = new Set(ancestors).add(value);
    return Object.fromEntries(Object.entries(value).filter(([,item]) => item !== undefined && typeof item !== "function" && typeof item !== "symbol").sort(([left],[right]) => left < right ? -1 : left > right ? 1 : 0).map(([key,item]) => [key,canonicalize(item,next)]));
  }
  return null;
};
export const stableSerialize = (value: unknown): string => JSON.stringify(canonicalize(value,new Set<object>()));
export const fingerprint = (value: unknown): string => createHash("sha256").update(stableSerialize(value)).digest("hex");
export const validateSourceCommandResult = (value: unknown): TaskCommandResult => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const record=value as Record<string,unknown>;
  if (Object.keys(record).sort().join(",") !== "sourceCommandId,status" || record["status"] !== "accepted") invalid();
  return { sourceCommandId: validateId(record["sourceCommandId"]), status: "accepted" };
};
