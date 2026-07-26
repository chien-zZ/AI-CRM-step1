import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgSchema, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";

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
}, (table) => [
  check("employments_valid_interval", sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`),
  unique("employments_id_person_unique").on(table.employmentId, table.workforcePersonId),
  index("employments_person_time_idx").on(table.workforcePersonId, table.effectiveFrom, table.effectiveTo),
]);

export const organizationUnits = organization.table("organization_units", {
  organizationUnitId: uuid("organization_unit_id").primaryKey(),
  effectiveFrom: timestamp("effective_from", { mode: "string", withTimezone: true }).notNull(),
  effectiveTo: timestamp("effective_to", { mode: "string", withTimezone: true }),
}, (table) => [
  check("organization_units_valid_interval", sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`),
]);

export const organizationUnitPlacements = organization.table("organization_unit_placements", {
  placementId: uuid("placement_id").primaryKey(),
  organizationUnitId: uuid("organization_unit_id").notNull().references(() => organizationUnits.organizationUnitId),
  parentOrganizationUnitId: uuid("parent_organization_unit_id").references(() => organizationUnits.organizationUnitId),
  effectiveFrom: timestamp("effective_from", { mode: "string", withTimezone: true }).notNull(),
  effectiveTo: timestamp("effective_to", { mode: "string", withTimezone: true }),
}, (table) => [
  check("organization_unit_placements_valid_interval", sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`),
  check("organization_unit_placements_not_self", sql`${table.parentOrganizationUnitId} is null or ${table.parentOrganizationUnitId} <> ${table.organizationUnitId}`),
  index("organization_unit_placements_time_idx").on(table.organizationUnitId, table.effectiveFrom, table.effectiveTo),
]);

export const positions = organization.table("positions", {
  positionId: uuid("position_id").primaryKey(),
  organizationUnitId: uuid("organization_unit_id").notNull().references(() => organizationUnits.organizationUnitId),
  effectiveFrom: timestamp("effective_from", { mode: "string", withTimezone: true }).notNull(),
  effectiveTo: timestamp("effective_to", { mode: "string", withTimezone: true }),
}, (table) => [
  check("positions_valid_interval", sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`),
  unique("positions_id_unit_unique").on(table.positionId, table.organizationUnitId),
]);

export const assignments = organization.table("assignments", {
  assignmentId: uuid("assignment_id").primaryKey(),
  workforcePersonId: uuid("workforce_person_id").notNull().references(() => workforcePeople.workforcePersonId),
  employmentId: uuid("employment_id").notNull(),
  organizationUnitId: uuid("organization_unit_id").notNull().references(() => organizationUnits.organizationUnitId),
  positionId: uuid("position_id").notNull(),
  effectiveFrom: timestamp("effective_from", { mode: "string", withTimezone: true }).notNull(),
  effectiveTo: timestamp("effective_to", { mode: "string", withTimezone: true }),
}, (table) => [
  check("assignments_valid_interval", sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`),
  foreignKey({
    columns: [table.employmentId, table.workforcePersonId],
    foreignColumns: [employments.employmentId, employments.workforcePersonId],
    name: "assignments_employment_person_fk",
  }),
  foreignKey({
    columns: [table.positionId, table.organizationUnitId],
    foreignColumns: [positions.positionId, positions.organizationUnitId],
    name: "assignments_position_unit_fk",
  }),
  index("assignments_person_time_idx").on(table.workforcePersonId, table.effectiveFrom, table.effectiveTo),
]);

export const subjectAssociations = organization.table("subject_associations", {
  associationId: uuid("association_id").primaryKey(),
  issuer: text("issuer").notNull(),
  subject: text("subject").notNull(),
  workforcePersonId: uuid("workforce_person_id").notNull().references(() => workforcePeople.workforcePersonId),
  effectiveFrom: timestamp("effective_from", { mode: "string", withTimezone: true }).notNull(),
  effectiveTo: timestamp("effective_to", { mode: "string", withTimezone: true }),
}, (table) => [
  check("subject_associations_issuer_length", sql`length(${table.issuer}) between 1 and 2048`),
  check("subject_associations_subject_length", sql`length(${table.subject}) between 1 and 255`),
  check("subject_associations_valid_interval", sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`),
  index("subject_associations_subject_time_idx").on(table.issuer, table.subject, table.effectiveFrom, table.effectiveTo),
  index("subject_associations_person_time_idx").on(table.workforcePersonId, table.effectiveFrom, table.effectiveTo),
]);

export const operationReceipts = organization.table("operation_receipts", {
  operationId: uuid("operation_id").primaryKey(),
  fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
  recordedAt: timestamp("recorded_at", { mode: "string", withTimezone: true }).defaultNow().notNull(),
}, (table) => [check("operation_receipts_fingerprint_length", sql`length(${table.fingerprint}) = 64`)]);
