import { sql } from "drizzle-orm";
import { check, index, jsonb, pgSchema, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

const audit = pgSchema("audit");
export const auditRecords = audit.table("records", {
  auditId: uuid("audit_id").primaryKey(), occurredAt: timestamp("occurred_at", { mode: "string", withTimezone: true }).notNull(),
  action: varchar("action", { length: 128 }).notNull(), actorId: varchar("actor_id", { length: 255 }).notNull(), actorType: varchar("actor_type", { length: 32 }).notNull(),
  workforcePersonId: uuid("workforce_person_id"), assignmentId: uuid("assignment_id"), resourceType: varchar("resource_type", { length: 128 }).notNull(), resourceId: varchar("resource_id", { length: 255 }).notNull(),
  result: varchar("result", { length: 16 }).notNull(), reasonCode: varchar("reason_code", { length: 128 }).notNull(), reasonDetail: varchar("reason_detail", { length: 500 }),
  traceId: varchar("trace_id", { length: 32 }).notNull(), authorizationDecisionId: uuid("authorization_decision_id"), operationId: uuid("operation_id").notNull(), changes: jsonb("changes").notNull(),
}, (table) => [
  check("audit_records_actor_type_check", sql`${table.actorType} in ('authenticated_subject','system')`),
  check("audit_records_result_check", sql`${table.result} in ('attempted','succeeded','failed','denied')`),
  check("audit_records_trace_id_check", sql`${table.traceId} ~ '^(?!0{32})[0-9a-f]{32}$'`),
  check("audit_records_changes_array_check", sql`jsonb_typeof(${table.changes}) = 'array'`),
  index("audit_records_resource_time_idx").on(table.resourceType, table.resourceId, table.occurredAt),
  index("audit_records_actor_time_idx").on(table.actorId, table.occurredAt),
]);

export const auditOperationReceipts = audit.table("operation_receipts", {
  operationId: uuid("operation_id").primaryKey(), auditId: uuid("audit_id").notNull().references(() => auditRecords.auditId), fingerprint: varchar("fingerprint", { length: 64 }).notNull(), recordedAt: timestamp("recorded_at", { mode: "string", withTimezone: true }).defaultNow().notNull(),
}, (table) => [check("audit_receipts_fingerprint_length", sql`length(${table.fingerprint}) = 64`)]);
