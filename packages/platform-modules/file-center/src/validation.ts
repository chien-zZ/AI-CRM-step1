import { createHash } from "node:crypto";
import { FileCenterError } from "./errors.js";
import type { FileActor, FileReference, ResourceReference } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TRACE = /^(?!0{32})[0-9a-f]{32}$/u;
const ID = /^[a-z][a-z0-9_.:-]{1,127}$/u;
const REFERENCE = /^[A-Za-z0-9_.:@/-]{1,255}$/u;
const MEDIA_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const invalid = (): never => { throw new FileCenterError("file_center_invalid_input"); };

export const plainObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) => descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.enumerable)) return invalid();
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
};
export const exact = (value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> => {
  const parsed = plainObject(value);
  const keys = Object.keys(parsed);
  if (required.some((key) => !Object.hasOwn(parsed, key)) || keys.some((key) => !required.includes(key) && !optional.includes(key))) return invalid();
  return parsed;
};
export const uuid = (value: unknown): string => typeof value === "string" && UUID.test(value) ? value.toLowerCase() : invalid();
export const trace = (value: unknown): string => typeof value === "string" && TRACE.test(value) ? value.toLowerCase() : invalid();
export const id = (value: unknown): string => typeof value === "string" && ID.test(value) ? value : invalid();
export const reference = (value: unknown): string => typeof value === "string" && REFERENCE.test(value) ? value : invalid();
export const mediaType = (value: unknown): string => typeof value === "string" && value.length <= 255 && MEDIA_TYPE.test(value) ? value.toLowerCase() : invalid();
export const sha256 = (value: unknown): string => typeof value === "string" && SHA256.test(value) ? value : invalid();
export const date = (value: unknown): string => {
  if (typeof value !== "string") return invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return invalid();
  return value;
};
export const positiveInteger = (value: unknown, maximum: number): number => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= maximum ? value as number : invalid();
const hasOnlyDisplayCharacters = (value: string): boolean => {
  for (const character of value) { const code = character.codePointAt(0) ?? 0; if (code <= 31 || code === 127) return false; }
  return true;
};
export const bounded = (value: unknown, maximum: number): string => typeof value === "string" && value.length > 0 && value.length <= maximum && hasOnlyDisplayCharacters(value) ? value : invalid();
export const actor = (value: unknown): FileActor => {
  const parsed = exact(value, ["actorId", "actorType"], ["assignmentId"]);
  if (parsed.actorType !== "authenticated_subject" && parsed.actorType !== "system") return invalid();
  return { actorId: reference(parsed.actorId), actorType: parsed.actorType, ...(parsed.assignmentId === undefined ? {} : { assignmentId: uuid(parsed.assignmentId) }) };
};
export const resource = (value: unknown): ResourceReference => {
  const parsed = exact(value, ["resourceId", "resourceType"]);
  return { resourceId: reference(parsed.resourceId), resourceType: id(parsed.resourceType) };
};
export const fileReference = (value: unknown): FileReference => {
  const parsed = exact(value, ["contentVersionId", "displayName", "fileId", "version"], ["mediaType", "sizeBytes"]);
  if (parsed.version !== 1) return invalid();
  return { contentVersionId: uuid(parsed.contentVersionId), displayName: bounded(parsed.displayName, 255), fileId: uuid(parsed.fileId), ...(parsed.mediaType === undefined ? {} : { mediaType: mediaType(parsed.mediaType) }), ...(parsed.sizeBytes === undefined ? {} : { sizeBytes: positiveInteger(parsed.sizeBytes, Number.MAX_SAFE_INTEGER) }), version: 1 };
};
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  if (value === null || typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return JSON.stringify(value);
  return invalid();
};
export const fingerprint = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");
export const safeDisposition = (displayName: string): string => {
  const fallback = displayName.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 120) || "download";
  return `attachment; filename="${fallback.replaceAll('"', "_")}"`;
};
