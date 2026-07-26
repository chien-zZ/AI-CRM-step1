import { randomUUID } from "node:crypto";
import { AuditError } from "./errors.js";
import type { AuditStore } from "./store.js";
import type { AuditAuthorizer, AuditRecord, AuditService, AuditServiceOptions, RecordAuditCommand, SensitiveAuditAccessCommand } from "./types.js";
import { fingerprint, validateAuthorizationDecision, validateOptions, validateRecord, validateSensitiveAccess } from "./validation.js";

export function createAuditService(store: AuditStore, authorizer: AuditAuthorizer, options: AuditServiceOptions): AuditService {
  validateOptions(options);
  const clock = options.clock ?? (() => new Date());
  const id = options.id ?? randomUUID;
  const record = async (command: RecordAuditCommand): Promise<{ readonly auditId: string; readonly replayed: boolean }> => {
    let validated: AuditRecord;
    try {
      const occurredAt = command.occurredAt ?? clock().toISOString();
      validated = validateRecord(command, command.auditId ?? id(), occurredAt, options.fieldPolicies);
    } catch (error) {
      if (error instanceof AuditError) throw error;
      throw new AuditError("audit_invalid_input", { cause: error });
    }
    try {
      return await store.append({ fingerprint: fingerprint(validated), record: validated });
    } catch (error) {
      if (error instanceof AuditError) throw error;
      throw new AuditError("audit_store_unavailable", { cause: error, retryable: true });
    }
  };

  return {
    record,
    readSensitive: async (input: SensitiveAuditAccessCommand) => {
      const command = validateSensitiveAccess(input);
      const resource = { resourceId: command.recordId, resourceType: "audit_record" };
      let decision;
      try {
        decision = validateAuthorizationDecision(await authorizer.authorize({ action: "audit:read_sensitive", actor: command.actor, resource }));
      } catch (error) {
        throw new AuditError("audit_authorization_unavailable", { cause: error, retryable: true });
      }
      const base = { action: "audit.read_sensitive", actor: command.actor, reason: { code: "sensitive_access", detail: command.reason }, resource, trace: { authorizationDecisionId: decision.decisionId, operationId: command.operationId, traceId: command.traceId } } as const;
      if (!decision.allowed) {
        await record({ ...base, result: "denied" });
        throw new AuditError("audit_access_denied");
      }
      let found: AuditRecord | undefined;
      try {
        found = await store.findById(command.recordId);
      } catch (error) {
        await record({ ...base, result: "failed" });
        throw new AuditError("audit_store_unavailable", { cause: error, retryable: true });
      }
      if (found === undefined) {
        await record({ ...base, result: "failed" });
        throw new AuditError("audit_record_not_found");
      }
      await record({ ...base, result: "succeeded" });
      return found;
    },
  };
}
