import { OrganizationError } from "./errors.js";
import { describeOrganizationWrite, type OrganizationCommit, type OrganizationCommitResult, type OrganizationStore, type OrganizationWrite } from "./store.js";
import type {
  Assignment,
  AuthenticationSubject,
  Employment,
  OrganizationUnit,
  OrganizationUnitPlacement,
  Position,
  SubjectAssociation,
  WorkforcePerson,
} from "./types.js";

export interface OrganizationPersistenceResult<Row = Record<string, unknown>> {
  readonly rowCount: number;
  readonly rows: readonly Row[];
}

export interface OrganizationPersistenceRuntime {
  execute<Row = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<OrganizationPersistenceResult<Row>>;
  recordAuditIntent(intent: {
    readonly action: string;
    readonly actorId: string;
    readonly actorType: string;
    readonly entityId: string;
    readonly entityType: string;
    readonly operationId: string;
    readonly reason: string;
    readonly result: "succeeded";
    readonly traceId: string;
  }): Promise<void>;
  recordEventIntent(intent: {
    readonly effectiveAt: string;
    readonly entityId: string;
    readonly entityType: string;
    readonly eventType: string;
    readonly operationId: string;
    readonly traceId: string;
    readonly workforcePersonId?: string;
  }): Promise<void>;
  withTransaction<T>(work: () => Promise<T>): Promise<T>;
}

interface IntervalRow {
  readonly effective_from: Date | string;
  readonly effective_to: Date | string | null;
}

class PostgresOrganizationStore implements OrganizationStore {
  constructor(private readonly executor: OrganizationPersistenceRuntime) {}

  async commit(command: OrganizationCommit): Promise<OrganizationCommitResult> {
    return this.executor.withTransaction(async () => {
      const claimed = await this.executor.execute<{ fingerprint: string }>(
        `insert into organization.operation_receipts (operation_id, fingerprint)
         values ($1, $2) on conflict (operation_id) do nothing returning fingerprint`,
        [command.operationId, command.fingerprint],
      );
      if (claimed.rowCount === 0) {
        const prior = await this.executor.execute<{ fingerprint: string }>(
          "select fingerprint from organization.operation_receipts where operation_id = $1",
          [command.operationId],
        );
        if (prior.rows[0]?.fingerprint !== command.fingerprint) throw new OrganizationError("idempotency_conflict");
        return { replayed: true };
      }

      await this.#apply(command.write);
      const target = describeOrganizationWrite(command.write);
      await this.executor.recordAuditIntent({
        action: command.auditAction,
        actorId: command.actor.actorId,
        actorType: command.actor.actorType,
        entityId: target.entityId,
        entityType: target.entityType,
        operationId: command.operationId,
        reason: command.reason,
        result: "succeeded",
        traceId: command.traceId,
      });
      await this.executor.recordEventIntent({
        ...target, eventType: command.eventType, operationId: command.operationId, traceId: command.traceId,
      });
      return { replayed: false };
    });
  }

  async findAssignment(id: string): Promise<Assignment | undefined> {
    const result = await this.executor.execute<AssignmentRow>("select * from organization.assignments where assignment_id = $1", [id]);
    return result.rows[0] ? assignment(result.rows[0]) : undefined;
  }

  async findEmployment(id: string): Promise<Employment | undefined> {
    const result = await this.executor.execute<EmploymentRow>("select * from organization.employments where employment_id = $1", [id]);
    return result.rows[0] ? employment(result.rows[0]) : undefined;
  }

  async findOrganizationUnit(id: string): Promise<OrganizationUnit | undefined> {
    const result = await this.executor.execute<UnitRow>("select * from organization.organization_units where organization_unit_id = $1", [id]);
    return result.rows[0] ? unit(result.rows[0]) : undefined;
  }

  async findOrganizationUnitPlacement(id: string): Promise<OrganizationUnitPlacement | undefined> {
    const result = await this.executor.execute<PlacementRow>("select * from organization.organization_unit_placements where placement_id = $1", [id]);
    return result.rows[0] ? placement(result.rows[0]) : undefined;
  }

  async findPosition(id: string): Promise<Position | undefined> {
    const result = await this.executor.execute<PositionRow>("select * from organization.positions where position_id = $1", [id]);
    return result.rows[0] ? position(result.rows[0]) : undefined;
  }

  async findSubjectAssociation(id: string): Promise<SubjectAssociation | undefined> {
    const result = await this.executor.execute<AssociationRow>("select * from organization.subject_associations where association_id = $1", [id]);
    return result.rows[0] ? association(result.rows[0]) : undefined;
  }

  async findWorkforcePerson(id: string): Promise<WorkforcePerson | undefined> {
    const result = await this.executor.execute<PersonRow>("select * from organization.workforce_people where workforce_person_id = $1", [id]);
    return result.rows[0] ? person(result.rows[0]) : undefined;
  }

  async listActiveAssignments(id: string, at: string): Promise<readonly Assignment[]> {
    const result = await this.executor.execute<AssignmentRow>(
      `select * from organization.assignments where workforce_person_id = $1
       and effective_from <= $2::timestamptz and (effective_to is null or effective_to > $2::timestamptz)
       order by assignment_id`, [id, at],
    );
    return result.rows.map(assignment);
  }

  async listActiveEmployments(id: string, at: string): Promise<readonly Employment[]> {
    const result = await this.executor.execute<EmploymentRow>(
      `select * from organization.employments where workforce_person_id = $1
       and effective_from <= $2::timestamptz and (effective_to is null or effective_to > $2::timestamptz)
       order by employment_id`, [id, at],
    );
    return result.rows.map(employment);
  }

  async listActivePlacements(id: string, at: string): Promise<readonly OrganizationUnitPlacement[]> {
    const result = await this.executor.execute<PlacementRow>(
      `select * from organization.organization_unit_placements where organization_unit_id = $1
       and effective_from <= $2::timestamptz and (effective_to is null or effective_to > $2::timestamptz)
       order by placement_id`, [id, at],
    );
    return result.rows.map(placement);
  }

  async listPlacementChangeTimes(from: string, to?: string): Promise<readonly string[]> {
    const result = await this.executor.execute<{ effective_from: Date | string }>(
      `select distinct effective_from from organization.organization_unit_placements
       where effective_from > $1::timestamptz and ($2::timestamptz is null or effective_from < $2::timestamptz)
       order by effective_from`, [from, to ?? null],
    );
    return result.rows.map(({ effective_from: value }) => iso(value));
  }

  async listActiveSubjectAssociations(subject: AuthenticationSubject, at: string): Promise<readonly SubjectAssociation[]> {
    const result = await this.executor.execute<AssociationRow>(
      `select * from organization.subject_associations where issuer = $1 and subject = $2
       and effective_from <= $3::timestamptz and (effective_to is null or effective_to > $3::timestamptz)
       order by association_id`, [subject.issuer, subject.subject, at],
    );
    return result.rows.map(association);
  }

  async #apply(write: OrganizationWrite): Promise<void> {
    try {
      if (write.kind === "create_person") await this.executor.execute(
        "insert into organization.workforce_people (workforce_person_id, recorded_at) values ($1, $2)",
        [write.person.workforcePersonId, write.person.recordedAt],
      );
      if (write.kind === "create_employment") await this.executor.execute(
        "insert into organization.employments (employment_id, workforce_person_id, effective_from, effective_to) values ($1, $2, $3, $4)",
        [write.employment.employmentId, write.employment.workforcePersonId, write.employment.effectiveFrom, write.employment.effectiveTo ?? null],
      );
      if (write.kind === "create_organization_unit") {
        await this.executor.execute(
          "insert into organization.organization_units (organization_unit_id, effective_from, effective_to) values ($1, $2, $3)",
          [write.unit.organizationUnitId, write.unit.effectiveFrom, write.unit.effectiveTo ?? null],
        );
        await this.executor.execute(
          "insert into organization.organization_unit_placements (placement_id, organization_unit_id, parent_organization_unit_id, effective_from, effective_to) values ($1, $2, $3, $4, $5)",
          [write.placement.placementId, write.placement.organizationUnitId, write.placement.parentOrganizationUnitId ?? null, write.placement.effectiveFrom, write.placement.effectiveTo ?? null],
        );
      }
      if (write.kind === "create_organization_unit_placement") await this.executor.execute(
        "insert into organization.organization_unit_placements (placement_id, organization_unit_id, parent_organization_unit_id, effective_from, effective_to) values ($1, $2, $3, $4, $5)",
        [write.placement.placementId, write.placement.organizationUnitId, write.placement.parentOrganizationUnitId ?? null, write.placement.effectiveFrom, write.placement.effectiveTo ?? null],
      );
      if (write.kind === "create_position") await this.executor.execute(
        "insert into organization.positions (position_id, organization_unit_id, effective_from, effective_to) values ($1, $2, $3, $4)",
        [write.position.positionId, write.position.organizationUnitId, write.position.effectiveFrom, write.position.effectiveTo ?? null],
      );
      if (write.kind === "create_assignment") await this.executor.execute(
        "insert into organization.assignments (assignment_id, workforce_person_id, employment_id, organization_unit_id, position_id, effective_from, effective_to) values ($1, $2, $3, $4, $5, $6, $7)",
        [write.assignment.assignmentId, write.assignment.workforcePersonId, write.assignment.employmentId, write.assignment.organizationUnitId, write.assignment.positionId, write.assignment.effectiveFrom, write.assignment.effectiveTo ?? null],
      );
      if (write.kind === "create_subject_association") await this.executor.execute(
        "insert into organization.subject_associations (association_id, issuer, subject, workforce_person_id, effective_from, effective_to) values ($1, $2, $3, $4, $5, $6)",
        [write.association.associationId, write.association.issuer, write.association.subject, write.association.workforcePersonId, write.association.effectiveFrom, write.association.effectiveTo ?? null],
      );
      if (write.kind === "close_assignment") await this.#close("assignments", "assignment_id", write.factId, write.effectiveTo);
      if (write.kind === "close_employment") await this.#close("employments", "employment_id", write.factId, write.effectiveTo);
      if (write.kind === "close_organization_unit_placement") await this.#close("organization_unit_placements", "placement_id", write.factId, write.effectiveTo);
      if (write.kind === "close_subject_association") await this.#close("subject_associations", "association_id", write.factId, write.effectiveTo);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505" && write.kind === "create_subject_association") throw new OrganizationError("conflicting_subject_association");
      if (code === "P1001") throw new OrganizationError("organization_hierarchy_cycle");
      if (code === "23503") throw new OrganizationError("entity_not_found");
      if (code === "23505" || code === "23514" || code === "P0001") throw new OrganizationError("entity_conflict");
      throw error;
    }
  }

  async #close(table: string, idColumn: string, id: string, to: string): Promise<void> {
    const result = await this.executor.execute(
      `update organization.${table} set effective_to = $2 where ${idColumn} = $1
       and effective_from < $2::timestamptz and (effective_to is null or effective_to = $2::timestamptz)`, [id, to],
    );
    if (result.rowCount !== 1) throw new OrganizationError("effective_interval_invalid");
  }
}

interface PersonRow { readonly workforce_person_id: string; readonly recorded_at: Date | string }
interface EmploymentRow extends IntervalRow { readonly employment_id: string; readonly workforce_person_id: string }
interface UnitRow extends IntervalRow { readonly organization_unit_id: string }
interface PlacementRow extends IntervalRow { readonly organization_unit_id: string; readonly parent_organization_unit_id: string | null; readonly placement_id: string }
interface PositionRow extends IntervalRow { readonly organization_unit_id: string; readonly position_id: string }
interface AssignmentRow extends IntervalRow { readonly assignment_id: string; readonly employment_id: string; readonly organization_unit_id: string; readonly position_id: string; readonly workforce_person_id: string }
interface AssociationRow extends IntervalRow { readonly association_id: string; readonly issuer: string; readonly subject: string; readonly workforce_person_id: string }

const iso = (value: Date | string): string => typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
const interval = (row: IntervalRow) => ({ effectiveFrom: iso(row.effective_from), ...(row.effective_to ? { effectiveTo: iso(row.effective_to) } : {}) });
const person = (row: PersonRow): WorkforcePerson => ({ recordedAt: iso(row.recorded_at), workforcePersonId: row.workforce_person_id });
const employment = (row: EmploymentRow): Employment => ({ ...interval(row), employmentId: row.employment_id, workforcePersonId: row.workforce_person_id });
const unit = (row: UnitRow): OrganizationUnit => ({ ...interval(row), organizationUnitId: row.organization_unit_id });
const placement = (row: PlacementRow): OrganizationUnitPlacement => ({ ...interval(row), organizationUnitId: row.organization_unit_id, ...(row.parent_organization_unit_id ? { parentOrganizationUnitId: row.parent_organization_unit_id } : {}), placementId: row.placement_id });
const position = (row: PositionRow): Position => ({ ...interval(row), organizationUnitId: row.organization_unit_id, positionId: row.position_id });
const assignment = (row: AssignmentRow): Assignment => ({ ...interval(row), assignmentId: row.assignment_id, employmentId: row.employment_id, organizationUnitId: row.organization_unit_id, positionId: row.position_id, workforcePersonId: row.workforce_person_id });
const association = (row: AssociationRow): SubjectAssociation => ({ ...interval(row), associationId: row.association_id, issuer: row.issuer, subject: row.subject, workforcePersonId: row.workforce_person_id });

export function createPostgresOrganizationStore(executor: OrganizationPersistenceRuntime): OrganizationStore {
  return new PostgresOrganizationStore(executor);
}
