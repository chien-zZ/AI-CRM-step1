import { index, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const organization = pgSchema("organization");

export const workforcePeople = organization.table("workforce_people", {
  workforcePersonId: uuid("workforce_person_id").primaryKey(),
  recordedAt: timestamp("recorded_at", { mode: "string", withTimezone: true }).notNull(),
});

export const employments = organization.table("employments", {
  employmentId: uuid("employment_id").primaryKey(),
  workforcePersonId: uuid("workforce_person_id").notNull().references(() => workforcePeople.workforcePersonId),
  effectiveFrom: timestamp("effective_from", { mode: "string", withTimezone: true }).notNull(),
  effectiveTo: timestamp("effective_to", { mode: "string", withTimezone: true }),
}, (table) => [index("employments_person_time_idx").on(table.workforcePersonId, table.effectiveFrom, table.effectiveTo)]);

export const organizationUnits = organization.table("organization_units", {
  organizationUnitId: uuid("organization_unit_id").primaryKey(),
  effectiveFrom: timestamp("effective_from", { mode: "string", withTimezone: true }).notNull(),
  effectiveTo: timestamp("effective_to", { mode: "string", withTimezone: true }),
});

export const organizationUnitPlacements = organization.table("organization_unit_placements", {
  placementId: uuid("placement_id").primaryKey(),
  organizationUnitId: uuid("organization_unit_id").notNull().references(() => organizationUnits.organizationUnitId),
  parentOrganizationUnitId: uuid("parent_organization_unit_id").references(() => organizationUnits.organizationUnitId),
  effectiveFrom: timestamp("effective_from", { mode: "string", withTimezone: true }).notNull(),
  effectiveTo: timestamp("effective_to", { mode: "string", withTimezone: true }),
}, (table) => [index("organization_unit_placements_time_idx").on(table.organizationUnitId, table.effectiveFrom, table.effectiveTo)]);

export const positions = organization.table("positions", {
  positionId: uuid("position_id").primaryKey(),
  organizationUnitId: uuid("organization_unit_id").notNull().references(() => organizationUnits.organizationUnitId),
  effectiveFrom: timestamp("effective_from", { mode: "string", withTimezone: true }).notNull(),
  effectiveTo: timestamp("effective_to", { mode: "string", withTimezone: true }),
});

export const assignments = organization.table("assignments", {
  assignmentId: uuid("assignment_id").primaryKey(),
  workforcePersonId: uuid("workforce_person_id").notNull().references(() => workforcePeople.workforcePersonId),
  employmentId: uuid("employment_id").notNull().references(() => employments.employmentId),
  organizationUnitId: uuid("organization_unit_id").notNull().references(() => organizationUnits.organizationUnitId),
  positionId: uuid("position_id").notNull().references(() => positions.positionId),
  effectiveFrom: timestamp("effective_from", { mode: "string", withTimezone: true }).notNull(),
  effectiveTo: timestamp("effective_to", { mode: "string", withTimezone: true }),
}, (table) => [index("assignments_person_time_idx").on(table.workforcePersonId, table.effectiveFrom, table.effectiveTo)]);

export const subjectAssociations = organization.table("subject_associations", {
  associationId: uuid("association_id").primaryKey(),
  issuer: text("issuer").notNull(),
  subject: text("subject").notNull(),
  workforcePersonId: uuid("workforce_person_id").notNull().references(() => workforcePeople.workforcePersonId),
  effectiveFrom: timestamp("effective_from", { mode: "string", withTimezone: true }).notNull(),
  effectiveTo: timestamp("effective_to", { mode: "string", withTimezone: true }),
}, (table) => [
  index("subject_associations_subject_time_idx").on(table.issuer, table.subject, table.effectiveFrom, table.effectiveTo),
  index("subject_associations_person_time_idx").on(table.workforcePersonId, table.effectiveFrom, table.effectiveTo),
]);

export const operationReceipts = organization.table("operation_receipts", {
  operationId: uuid("operation_id").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  recordedAt: timestamp("recorded_at", { mode: "string", withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("operation_receipts_fingerprint_idx").on(table.operationId, table.fingerprint)]);
