import { createHash } from "node:crypto";
import { OrganizationError } from "./errors.js";
import type { OrganizationCommit, OrganizationStore, OrganizationWrite } from "./store.js";
import type {
  Assignment,
  AuthenticationSubject,
  CloseEffectiveFactCommand,
  CommandMetadata,
  CreateAssignmentCommand,
  CreateEmploymentCommand,
  CreateOrganizationUnitCommand,
  CreateOrganizationUnitPlacementCommand,
  CreatePositionCommand,
  CreateSubjectAssociationCommand,
  CreateWorkforcePersonCommand,
  OrganizationCommandAuthorizer,
  OrganizationServiceApi,
  WorkforceContext,
} from "./types.js";
import { intervalContains, isActive, requireId, requireInterval, requireText, requireTimestamp } from "./validation.js";

export class OrganizationService implements OrganizationServiceApi {
  constructor(
    private readonly store: OrganizationStore,
    private readonly authorizer: OrganizationCommandAuthorizer,
  ) {}

  async createWorkforcePerson(command: CreateWorkforcePersonCommand): Promise<void> {
    this.#metadata(command);
    requireId(command.workforcePersonId);
    requireTimestamp(command.recordedAt);
    await this.#authorize(command, "workforce_person_created", "workforce_person", command.workforcePersonId);
    await this.#commit(command, "workforce_person_created", "organization.workforce_person.created.v1", {
      kind: "create_person",
      person: { recordedAt: command.recordedAt, workforcePersonId: command.workforcePersonId },
    });
  }

  async createEmployment(command: CreateEmploymentCommand): Promise<void> {
    this.#metadata(command);
    this.#intervalEntity(command.employmentId, command);
    requireId(command.workforcePersonId);
    await this.#authorize(command, "employment_created", "employment", command.employmentId);
    if (!await this.store.findWorkforcePerson(command.workforcePersonId)) throw new OrganizationError("entity_not_found");
    await this.#commit(command, "employment_created", "organization.employment.created.v1", {
      employment: this.#withoutMetadata(command), kind: "create_employment",
    });
  }

  async createOrganizationUnit(command: CreateOrganizationUnitCommand): Promise<void> {
    this.#metadata(command);
    this.#intervalEntity(command.organizationUnitId, command);
    requireId(command.placementId);
    await this.#authorize(command, "organization_unit_created", "organization_unit", command.organizationUnitId);
    if (command.parentOrganizationUnitId) {
      requireId(command.parentOrganizationUnitId);
      const parent = await this.store.findOrganizationUnit(command.parentOrganizationUnitId);
      if (!parent) throw new OrganizationError("entity_not_found");
      if (!intervalContains(parent, command)) throw new OrganizationError("effective_interval_invalid");
      await this.#assertNoHierarchyCycle(command.organizationUnitId, command.parentOrganizationUnitId, command);
    }
    await this.#commit(command, "organization_unit_created", "organization.unit.created.v1", {
      kind: "create_organization_unit",
      placement: this.#withoutMetadata(command),
      unit: {
        effectiveFrom: command.effectiveFrom,
        ...(command.effectiveTo ? { effectiveTo: command.effectiveTo } : {}),
        organizationUnitId: command.organizationUnitId,
      },
    });
  }

  async createPosition(command: CreatePositionCommand): Promise<void> {
    this.#metadata(command);
    this.#intervalEntity(command.positionId, command);
    requireId(command.organizationUnitId);
    await this.#authorize(command, "position_created", "position", command.positionId);
    const unit = await this.store.findOrganizationUnit(command.organizationUnitId);
    if (!unit) throw new OrganizationError("entity_not_found");
    if (!intervalContains(unit, command)) throw new OrganizationError("effective_interval_invalid");
    await this.#commit(command, "position_created", "organization.position.created.v1", {
      kind: "create_position", position: this.#withoutMetadata(command),
    });
  }

  async createOrganizationUnitPlacement(command: CreateOrganizationUnitPlacementCommand): Promise<void> {
    this.#metadata(command);
    this.#intervalEntity(command.placementId, command);
    requireId(command.organizationUnitId);
    await this.#authorize(command, "organization_unit_placement_created", "organization_unit_placement", command.placementId);
    const unit = await this.store.findOrganizationUnit(command.organizationUnitId);
    if (!unit) throw new OrganizationError("entity_not_found");
    if (!intervalContains(unit, command)) throw new OrganizationError("effective_interval_invalid");
    if (command.parentOrganizationUnitId) {
      requireId(command.parentOrganizationUnitId);
      const parent = await this.store.findOrganizationUnit(command.parentOrganizationUnitId);
      if (!parent) throw new OrganizationError("entity_not_found");
      if (!intervalContains(parent, command)) throw new OrganizationError("effective_interval_invalid");
      await this.#assertNoHierarchyCycle(command.organizationUnitId, command.parentOrganizationUnitId, command);
    }
    await this.#commit(command, "organization_unit_placement_created", "organization.unit_placement.created.v1", {
      kind: "create_organization_unit_placement", placement: this.#withoutMetadata(command),
    });
  }

  async createAssignment(command: CreateAssignmentCommand): Promise<void> {
    this.#metadata(command);
    this.#intervalEntity(command.assignmentId, command);
    for (const id of [command.workforcePersonId, command.employmentId, command.organizationUnitId, command.positionId]) requireId(id);
    await this.#authorize(command, "assignment_created", "assignment", command.assignmentId);
    const [employment, unit, position] = await Promise.all([
      this.store.findEmployment(command.employmentId),
      this.store.findOrganizationUnit(command.organizationUnitId),
      this.store.findPosition(command.positionId),
    ]);
    if (!employment || employment.workforcePersonId !== command.workforcePersonId
      || !unit || !position || position.organizationUnitId !== command.organizationUnitId) {
      throw new OrganizationError("entity_not_found");
    }
    if (!intervalContains(employment, command) || !intervalContains(unit, command) || !intervalContains(position, command)) {
      throw new OrganizationError("effective_interval_invalid");
    }
    await this.#commit(command, "assignment_created", "organization.assignment.created.v1", {
      assignment: this.#withoutMetadata(command), kind: "create_assignment",
    });
  }

  async createSubjectAssociation(command: CreateSubjectAssociationCommand): Promise<void> {
    this.#metadata(command);
    this.#intervalEntity(command.associationId, command);
    requireId(command.workforcePersonId);
    this.#subject(command);
    await this.#authorize(command, "subject_association_created", "subject_association", command.associationId);
    if (!await this.store.findWorkforcePerson(command.workforcePersonId)) throw new OrganizationError("entity_not_found");
    await this.#commit(command, "subject_association_created", "organization.subject_association.created.v1", {
      association: this.#withoutMetadata(command), kind: "create_subject_association",
    });
  }

  async closeAssignment(command: CloseEffectiveFactCommand): Promise<void> {
    await this.#close(command, "close_assignment", "assignment_closed", "organization.assignment.closed.v1");
  }

  async closeEmployment(command: CloseEffectiveFactCommand): Promise<void> {
    await this.#close(command, "close_employment", "employment_closed", "organization.employment.closed.v1");
  }

  async closeOrganizationUnitPlacement(command: CloseEffectiveFactCommand): Promise<void> {
    await this.#close(command, "close_organization_unit_placement", "organization_unit_placement_closed", "organization.unit_placement.closed.v1");
  }

  async closeSubjectAssociation(command: CloseEffectiveFactCommand): Promise<void> {
    await this.#close(command, "close_subject_association", "subject_association_closed", "organization.subject_association.closed.v1");
  }

  async resolveWorkforceContext(subject: AuthenticationSubject, at: string, assignmentId?: string): Promise<WorkforceContext> {
    this.#subject(subject);
    requireTimestamp(at);
    const associations = await this.store.listActiveSubjectAssociations(subject, at);
    const [association] = associations;
    if (!association) throw new OrganizationError("subject_not_associated");
    if (associations.length !== 1) throw new OrganizationError("conflicting_subject_association");
    const workforcePersonId = association.workforcePersonId;
    const employments = await this.store.listActiveEmployments(workforcePersonId, at);
    if (employments.length === 0) throw new OrganizationError("employment_not_active");
    const activeEmploymentIds = new Set(employments.map(({ employmentId }) => employmentId));
    let assignments = (await this.store.listActiveAssignments(workforcePersonId, at))
      .filter((item) => activeEmploymentIds.has(item.employmentId));
    if (assignmentId) {
      requireId(assignmentId);
      assignments = assignments.filter((item) => item.assignmentId === assignmentId);
      if (assignments.length !== 1) throw new OrganizationError("assignment_not_active");
    }
    for (const assignment of assignments) {
      const [unit, position] = await Promise.all([
        this.store.findOrganizationUnit(assignment.organizationUnitId),
        this.store.findPosition(assignment.positionId),
      ]);
      if (!unit || !position || position.organizationUnitId !== assignment.organizationUnitId
        || !isActive(unit, at) || !isActive(position, at)) {
        throw new OrganizationError("organization_path_invalid");
      }
      await this.#assertValidOrganizationPath(assignment.organizationUnitId, at);
    }
    return {
      assignments: assignments.map((assignment) => this.#assignmentReference(assignment)),
      employmentIds: [...activeEmploymentIds].sort(),
      resolvedAt: at,
      subject: { ...subject },
      workforcePersonId,
    };
  }

  async #assertNoHierarchyCycle(unitId: string, parentId: string, interval: { readonly effectiveFrom: string; readonly effectiveTo?: string }): Promise<void> {
    const changeTimes = await this.store.listPlacementChangeTimes(interval.effectiveFrom, interval.effectiveTo);
    for (const at of [interval.effectiveFrom, ...changeTimes]) await this.#assertNoHierarchyCycleAt(unitId, parentId, at);
  }

  async #assertNoHierarchyCycleAt(unitId: string, parentId: string, at: string): Promise<void> {
    const visited = new Set([unitId]);
    let current: string | undefined = parentId;
    while (current) {
      if (visited.has(current)) throw new OrganizationError("organization_hierarchy_cycle");
      visited.add(current);
      const unit = await this.store.findOrganizationUnit(current);
      if (!unit || !isActive(unit, at)) throw new OrganizationError("organization_path_invalid");
      const placements = await this.store.listActivePlacements(current, at);
      const [placement] = placements;
      if (!placement || placements.length !== 1) throw new OrganizationError("organization_path_invalid");
      current = placement.parentOrganizationUnitId;
    }
  }

  async #assertValidOrganizationPath(unitId: string, at: string): Promise<void> {
    const visited = new Set<string>();
    let current: string | undefined = unitId;
    while (current) {
      if (visited.has(current)) throw new OrganizationError("organization_hierarchy_cycle");
      visited.add(current);
      const unit = await this.store.findOrganizationUnit(current);
      if (!unit || !isActive(unit, at)) throw new OrganizationError("organization_path_invalid");
      const placements = await this.store.listActivePlacements(current, at);
      const [placement] = placements;
      if (!placement || placements.length !== 1) throw new OrganizationError("organization_path_invalid");
      current = placement.parentOrganizationUnitId;
    }
  }

  async #close(command: CloseEffectiveFactCommand, kind: "close_assignment" | "close_employment" | "close_organization_unit_placement" | "close_subject_association", auditAction: string, eventType: string): Promise<void> {
    this.#metadata(command);
    requireId(command.factId);
    requireTimestamp(command.effectiveTo);
    const entityType = kind === "close_assignment" ? "assignment"
      : kind === "close_employment" ? "employment"
        : kind === "close_organization_unit_placement" ? "organization_unit_placement" : "subject_association";
    await this.#authorize(command, auditAction, entityType, command.factId);
    const fact = kind === "close_assignment"
      ? await this.store.findAssignment(command.factId)
      : kind === "close_employment"
        ? await this.store.findEmployment(command.factId)
        : kind === "close_organization_unit_placement"
          ? await this.store.findOrganizationUnitPlacement(command.factId)
          : await this.store.findSubjectAssociation(command.factId);
    if (!fact) throw new OrganizationError("entity_not_found");
    if (Date.parse(command.effectiveTo) <= Date.parse(fact.effectiveFrom)
      || (fact.effectiveTo !== undefined && fact.effectiveTo !== command.effectiveTo)) {
      throw new OrganizationError("effective_interval_invalid");
    }
    const workforcePersonId = "workforcePersonId" in fact ? fact.workforcePersonId : undefined;
    const write: OrganizationWrite = {
      effectiveTo: command.effectiveTo, factId: command.factId, kind,
      ...(workforcePersonId ? { workforcePersonId } : {}),
    };
    await this.#commit(command, auditAction, eventType, write);
  }

  async #commit(command: CommandMetadata, auditAction: string, eventType: string, write: OrganizationWrite): Promise<void> {
    const fingerprint = createHash("sha256").update(JSON.stringify({
      actor: command.actor, auditAction, reason: command.reason, write,
    })).digest("hex");
    const commit: OrganizationCommit = {
      actor: command.actor, auditAction, eventType, fingerprint, operationId: command.operationId,
      reason: command.reason, traceId: command.traceId, write,
    };
    await this.store.commit(commit);
  }

  async #authorize(command: CommandMetadata, action: string, entityType: string, entityId: string): Promise<void> {
    await this.authorizer.authorize({ action, actor: command.actor, entityId, entityType, operationId: command.operationId });
  }

  #assignmentReference(assignment: Assignment) {
    return {
      assignmentId: assignment.assignmentId,
      employmentId: assignment.employmentId,
      organizationUnitId: assignment.organizationUnitId,
      positionId: assignment.positionId,
    };
  }

  #intervalEntity(id: string, interval: { readonly effectiveFrom: string; readonly effectiveTo?: string }): void {
    requireId(id);
    requireInterval(interval);
  }

  #metadata(metadata: CommandMetadata): void {
    requireId(metadata.operationId);
    requireText(metadata.actor.actorId);
    requireText(metadata.reason, 500);
    requireText(metadata.traceId, 128);
  }

  #subject(subject: AuthenticationSubject): void {
    requireText(subject.issuer, 2048);
    requireText(subject.subject);
    let parsed: URL;
    try { parsed = new URL(subject.issuer); } catch { throw new OrganizationError("entity_conflict"); }
    const loopbackHttp = parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    if (parsed.protocol !== "https:" && !loopbackHttp) {
      throw new OrganizationError("entity_conflict");
    }
  }

  #withoutMetadata<T extends CommandMetadata>(value: T): Omit<T, keyof CommandMetadata> {
    const { actor, operationId, reason, traceId, ...result } = value;
    void actor;
    void operationId;
    void reason;
    void traceId;
    return result;
  }
}
