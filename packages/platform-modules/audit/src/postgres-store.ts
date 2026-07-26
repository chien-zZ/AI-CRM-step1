import { AuditError } from "./errors.js";
import type { AuditAppend, AuditPersistenceRuntime, AuditStore } from "./store.js";
import type { AuditRecord } from "./types.js";

interface AuditRow {
  readonly action: string; readonly actor_id: string; readonly actor_type: "authenticated_subject" | "system"; readonly assignment_id: string | null;
  readonly audit_id: string; readonly authorization_decision_id: string | null; readonly changes: AuditRecord["changes"]; readonly occurred_at: Date | string;
  readonly operation_id: string; readonly reason_code: string; readonly reason_detail: string | null; readonly resource_id: string; readonly resource_type: string;
  readonly result: AuditRecord["result"]; readonly trace_id: string; readonly workforce_person_id: string | null;
}

class PostgresAuditStore implements AuditStore {
  constructor(private readonly runtime: AuditPersistenceRuntime) {}

  async append({ fingerprint, record }: AuditAppend): Promise<{ readonly auditId: string; readonly replayed: boolean }> {
    return this.runtime.withTransaction(async () => {
      await this.runtime.execute("select pg_advisory_xact_lock(hashtextextended($1::text, 0))", [record.trace.operationId]);
      const prior = await this.runtime.execute<{ audit_id: string; fingerprint: string }>("select audit_id, fingerprint from audit.operation_receipts where operation_id = $1 for update", [record.trace.operationId]);
      if (prior.rows[0] !== undefined) {
        if (prior.rows[0].fingerprint !== fingerprint) throw new AuditError("audit_operation_conflict");
        return { auditId: prior.rows[0].audit_id, replayed: true };
      }
      try {
        await this.runtime.execute("insert into audit.records (audit_id, occurred_at, action, actor_id, actor_type, workforce_person_id, assignment_id, resource_type, resource_id, result, reason_code, reason_detail, trace_id, authorization_decision_id, operation_id, changes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)", [record.auditId, record.occurredAt, record.action, record.actor.actorId, record.actor.actorType, record.actor.workforcePersonId ?? null, record.actor.assignmentId ?? null, record.resource.resourceType, record.resource.resourceId, record.result, record.reason.code, record.reason.detail ?? null, record.trace.traceId, record.trace.authorizationDecisionId ?? null, record.trace.operationId, JSON.stringify(record.changes ?? [])]);
        await this.runtime.execute("insert into audit.operation_receipts (operation_id, audit_id, fingerprint) values ($1,$2,$3)", [record.trace.operationId, record.auditId, fingerprint]);
      } catch (error) {
        if ((error as { readonly code?: string }).code === "23505") throw new AuditError("audit_operation_conflict");
        throw error;
      }
      return { auditId: record.auditId, replayed: false };
    });
  }

  async findById(auditId: string): Promise<AuditRecord | undefined> {
    const result = await this.runtime.execute<AuditRow>("select * from audit.records where audit_id = $1", [auditId]);
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return { action: row.action, actor: { actorId: row.actor_id, actorType: row.actor_type, ...(row.assignment_id === null ? {} : { assignmentId: row.assignment_id }), ...(row.workforce_person_id === null ? {} : { workforcePersonId: row.workforce_person_id }) }, auditId: row.audit_id, ...(row.changes === undefined || row.changes.length === 0 ? {} : { changes: row.changes }), occurredAt: typeof row.occurred_at === "string" ? new Date(row.occurred_at).toISOString() : row.occurred_at.toISOString(), reason: { code: row.reason_code, ...(row.reason_detail === null ? {} : { detail: row.reason_detail }) }, resource: { resourceId: row.resource_id, resourceType: row.resource_type }, result: row.result, trace: { ...(row.authorization_decision_id === null ? {} : { authorizationDecisionId: row.authorization_decision_id }), operationId: row.operation_id, traceId: row.trace_id }, version: 1 };
  }
}

export function createPostgresAuditStore(runtime: AuditPersistenceRuntime): AuditStore {
  return new PostgresAuditStore(runtime);
}
