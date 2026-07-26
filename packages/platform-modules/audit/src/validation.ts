import { createHash } from "node:crypto";
import { AuditError } from "./errors.js";
import type { AuditChange, AuditFieldPolicy, AuditRecord, AuditServiceOptions, RecordAuditCommand } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TRACE_ID = /^(?!0{32})[0-9a-f]{32}$/u;
const CODE = /^[a-z][a-z0-9_.:-]{0,127}$/u;
const REFERENCE = /^[A-Za-z0-9_.:@/-]{1,255}$/u;
const FORBIDDEN_FIELD = /(authorization|cookie|credential|password|payload|prompt|request|response|secret|session|token)/iu;

const invalid = (): never => { throw new AuditError("audit_invalid_input"); };
const validDate = (value: string): boolean => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function validateOptions(options: AuditServiceOptions): void {
  for (const [action, fields] of Object.entries(options.fieldPolicies)) {
    if (!CODE.test(action) || fields.length > 100) invalid();
    const names = new Set<string>();
    for (const policy of fields) {
      if (!CODE.test(policy.field) || FORBIDDEN_FIELD.test(policy.field) || names.has(policy.field)) invalid();
      names.add(policy.field);
    }
  }
}

const validateChanges = (action: string, changes: readonly AuditChange[] | undefined, policies: Readonly<Record<string, readonly AuditFieldPolicy[]>>): void => {
  if (changes === undefined) return;
  if (changes.length > 100) invalid();
  const policy = new Map((policies[action] ?? []).map((field) => [field.field, field.classification]));
  const names = new Set<string>();
  for (const change of changes) {
    if (names.has(change.field) || policy.get(change.field) !== change.classification) invalid();
    names.add(change.field);
    if (change.classification === "non_sensitive") {
      if (!("before" in change) && !("after" in change)) invalid();
      for (const value of [change.before, change.after]) {
        if (typeof value === "string" && value.length > 500) invalid();
        if (typeof value === "number" && !Number.isFinite(value)) invalid();
      }
    }
  }
};

export function validateRecord(command: RecordAuditCommand, auditId: string, occurredAt: string, policies: Readonly<Record<string, readonly AuditFieldPolicy[]>>): AuditRecord {
  if (!UUID.test(auditId) || !validDate(occurredAt) || !CODE.test(command.action) || !CODE.test(command.resource.resourceType) ||
    !REFERENCE.test(command.resource.resourceId) || !REFERENCE.test(command.actor.actorId) || !CODE.test(command.reason.code) ||
    (command.reason.detail !== undefined && (command.reason.detail.length < 1 || command.reason.detail.length > 500)) ||
    !UUID.test(command.trace.operationId) || !TRACE_ID.test(command.trace.traceId) ||
    (command.trace.authorizationDecisionId !== undefined && !UUID.test(command.trace.authorizationDecisionId)) ||
    (command.actor.assignmentId !== undefined && !UUID.test(command.actor.assignmentId)) ||
    (command.actor.workforcePersonId !== undefined && !UUID.test(command.actor.workforcePersonId))) invalid();
  validateChanges(command.action, command.changes, policies);
  return Object.freeze({ ...command, auditId: auditId.toLowerCase(), occurredAt, trace: { ...command.trace, operationId: command.trace.operationId.toLowerCase(), traceId: command.trace.traceId.toLowerCase() }, version: 1 });
}

export const fingerprint = (record: AuditRecord): string => createHash("sha256").update(JSON.stringify({
  ...record,
  auditId: undefined,
  occurredAt: undefined,
  trace: { operationId: record.trace.operationId },
})).digest("hex");

export function validateSensitiveAccess(input: { readonly operationId: string; readonly reason: string; readonly recordId: string; readonly traceId: string }): void {
  if (!UUID.test(input.operationId) || !UUID.test(input.recordId) || !TRACE_ID.test(input.traceId) || input.reason.length < 1 || input.reason.length > 500) invalid();
}
