import { createHash } from "node:crypto";
import { AuditError } from "./errors.js";
import type { AuditActor, AuditAuthorizationDecision, AuditChange, AuditFieldPolicy, AuditRecord, AuditResult, AuditServiceOptions, RecordAuditCommand, SensitiveAuditAccessCommand } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TRACE_ID = /^(?!0{32})[0-9a-f]{32}$/u;
const CODE = /^[a-z][a-z0-9_.:-]{0,127}$/u;
const REFERENCE = /^[A-Za-z0-9_.:@/-]{1,255}$/u;
const FORBIDDEN_FIELD = /(authorization|cookie|credential|password|payload|prompt|request|response|secret|session|token)/iu;

const invalid = (): never => { throw new AuditError("audit_invalid_input"); };
const object = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const exact = (value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> => {
  const candidate = object(value);
  const keys = Object.keys(candidate);
  if (required.some((key) => !Object.hasOwn(candidate, key)) || keys.some((key) => !required.includes(key) && !optional.includes(key))) invalid();
  return candidate;
};
const array = (value: unknown, maximum: number): unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value as unknown[];
};
const string = (value: unknown, pattern: RegExp): string => typeof value === "string" && pattern.test(value) ? value : invalid();
const boolean = (value: unknown): boolean => typeof value === "boolean" ? value : invalid();
const classification = (value: unknown): "non_sensitive" | "sensitive" => value === "non_sensitive" || value === "sensitive" ? value : invalid();
const validDate = (value: string): boolean => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

const validateActor = (value: unknown): AuditActor => {
  const actor = exact(value, ["actorId", "actorType"], ["assignmentId", "workforcePersonId"]);
  const actorType = actor.actorType === "authenticated_subject" || actor.actorType === "system" ? actor.actorType : invalid();
  return {
    actorId: string(actor.actorId, REFERENCE),
    actorType,
    ...(actor.assignmentId === undefined ? {} : { assignmentId: string(actor.assignmentId, UUID).toLowerCase() }),
    ...(actor.workforcePersonId === undefined ? {} : { workforcePersonId: string(actor.workforcePersonId, UUID).toLowerCase() }),
  };
};

export function validateOptions(value: AuditServiceOptions): void {
  const options = exact(value, ["fieldPolicies"], ["clock", "id"]);
  if ((options.clock !== undefined && typeof options.clock !== "function") || (options.id !== undefined && typeof options.id !== "function")) invalid();
  const policyRegistry = object(options.fieldPolicies);
  for (const [action, candidateFields] of Object.entries(policyRegistry)) {
    if (!CODE.test(action)) invalid();
    const valueFields = array(candidateFields, 100);
    const names = new Set<string>();
    for (const valueField of valueFields) {
      const field = exact(valueField, ["classification", "field"]);
      classification(field.classification);
      const fieldName = string(field.field, CODE);
      if (FORBIDDEN_FIELD.test(fieldName) || names.has(fieldName)) invalid();
      names.add(fieldName);
    }
  }
}

const scalar = (value: unknown): value is boolean | number | string | null => value === null || typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
const validateChanges = (action: string, value: unknown, policies: Readonly<Record<string, readonly AuditFieldPolicy[]>>): readonly AuditChange[] | undefined => {
  if (value === undefined) return undefined;
  const candidates = array(value, 100);
  const policy = new Map((policies[action] ?? []).map((field) => [field.field, field.classification]));
  const names = new Set<string>();
  return candidates.map((candidate): AuditChange => {
    const changeClassification = classification(object(candidate).classification);
    const change = changeClassification === "non_sensitive"
      ? exact(candidate, ["classification", "field"], ["after", "before"])
      : exact(candidate, ["changed", "classification", "field"]);
    const field = string(change.field, CODE);
    if (names.has(field) || policy.get(field) !== changeClassification) invalid();
    names.add(field);
    if (changeClassification === "sensitive") {
      if (change.changed !== true) invalid();
      return { changed: true, classification: changeClassification, field };
    }
    if (!Object.hasOwn(change, "before") && !Object.hasOwn(change, "after")) invalid();
    if ((Object.hasOwn(change, "before") && !scalar(change.before)) || (Object.hasOwn(change, "after") && !scalar(change.after))) invalid();
    if ((typeof change.before === "string" && change.before.length > 500) || (typeof change.after === "string" && change.after.length > 500)) invalid();
    return { ...(Object.hasOwn(change, "after") ? { after: change.after as boolean | number | string | null } : {}), ...(Object.hasOwn(change, "before") ? { before: change.before as boolean | number | string | null } : {}), classification: changeClassification, field };
  });
};

export function validateRecord(value: RecordAuditCommand, auditIdValue: string, occurredAtValue: string, policies: Readonly<Record<string, readonly AuditFieldPolicy[]>>): AuditRecord {
  const command = exact(value, ["action", "actor", "reason", "resource", "result", "trace"], ["auditId", "changes", "occurredAt"]);
  const action = string(command.action, CODE);
  const actor = validateActor(command.actor);
  const reason = exact(command.reason, ["code"], ["detail"]);
  const detail = reason.detail === undefined ? undefined : typeof reason.detail === "string" && reason.detail.length >= 1 && reason.detail.length <= 500 ? reason.detail : invalid();
  const resource = exact(command.resource, ["resourceId", "resourceType"]);
  const trace = exact(command.trace, ["operationId", "traceId"], ["authorizationDecisionId"]);
  const result: AuditResult = command.result === "attempted" || command.result === "denied" || command.result === "failed" || command.result === "succeeded" ? command.result : invalid();
  const auditId = string(auditIdValue, UUID).toLowerCase();
  if (typeof occurredAtValue !== "string" || !validDate(occurredAtValue)) invalid();
  const changes = validateChanges(action, command.changes, policies);
  return Object.freeze({
    action,
    actor,
    auditId,
    ...(changes === undefined ? {} : { changes }),
    occurredAt: occurredAtValue,
    reason: { code: string(reason.code, CODE), ...(detail === undefined ? {} : { detail }) },
    resource: { resourceId: string(resource.resourceId, REFERENCE), resourceType: string(resource.resourceType, CODE) },
    result,
    trace: {
      ...(trace.authorizationDecisionId === undefined ? {} : { authorizationDecisionId: string(trace.authorizationDecisionId, UUID).toLowerCase() }),
      operationId: string(trace.operationId, UUID).toLowerCase(),
      traceId: string(trace.traceId, TRACE_ID).toLowerCase(),
    },
    version: 1,
  });
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) return `{${Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
};

export const fingerprint = (record: AuditRecord): string => {
  const semantic = {
    action: record.action,
    actor: record.actor,
    ...(record.changes === undefined ? {} : { changes: [...record.changes].sort((a, b) => a.field.localeCompare(b.field)) }),
    reason: record.reason,
    resource: record.resource,
    result: record.result,
    trace: { operationId: record.trace.operationId },
    version: record.version,
  };
  return createHash("sha256").update(canonical(semantic)).digest("hex");
};

export function validateSensitiveAccess(value: SensitiveAuditAccessCommand): SensitiveAuditAccessCommand {
  const input = exact(value, ["actor", "operationId", "reason", "recordId", "traceId"]);
  const reason = typeof input.reason === "string" && input.reason.length >= 1 && input.reason.length <= 500 ? input.reason : invalid();
  return { actor: validateActor(input.actor), operationId: string(input.operationId, UUID).toLowerCase(), reason, recordId: string(input.recordId, UUID).toLowerCase(), traceId: string(input.traceId, TRACE_ID).toLowerCase() };
}

export function validateAuthorizationDecision(value: unknown): AuditAuthorizationDecision {
  const decision = exact(value, ["allowed", "decisionId"]);
  const allowed = boolean(decision.allowed);
  return { allowed, decisionId: string(decision.decisionId, UUID).toLowerCase() };
}
