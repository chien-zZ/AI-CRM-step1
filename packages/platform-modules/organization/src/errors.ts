export type OrganizationErrorCode =
  | "assignment_not_active"
  | "conflicting_subject_association"
  | "effective_interval_invalid"
  | "employment_not_active"
  | "entity_conflict"
  | "entity_not_found"
  | "idempotency_conflict"
  | "organization_hierarchy_cycle"
  | "organization_path_invalid"
  | "subject_not_associated";

export class OrganizationError extends Error {
  constructor(readonly code: OrganizationErrorCode) {
    super(code);
    this.name = "OrganizationError";
  }
}
