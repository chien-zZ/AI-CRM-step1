import { AuditError } from "./errors.js";
import type { AuditAppend, AuditStore } from "./store.js";
import type { AuditRecord } from "./types.js";

export function createMemoryAuditStore(): AuditStore {
  const records = new Map<string, AuditRecord>();
  const operations = new Map<string, { readonly auditId: string; readonly fingerprint: string }>();
  return {
    append: ({ fingerprint, record }: AuditAppend) => {
      const prior = operations.get(record.trace.operationId);
      if (prior !== undefined) {
        if (prior.fingerprint !== fingerprint) throw new AuditError("audit_operation_conflict");
        return Promise.resolve({ auditId: prior.auditId, replayed: true });
      }
      if (records.has(record.auditId)) throw new AuditError("audit_operation_conflict");
      records.set(record.auditId, structuredClone(record));
      operations.set(record.trace.operationId, { auditId: record.auditId, fingerprint });
      return Promise.resolve({ auditId: record.auditId, replayed: false });
    },
    findById: (auditId) => {
      const found = records.get(auditId);
      return Promise.resolve(found === undefined ? undefined : structuredClone(found));
    },
  };
}
