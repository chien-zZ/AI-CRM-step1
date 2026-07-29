import { OrganizationError } from "./errors.js";
import type { OrganizationCommit, OrganizationCommitResult, OrganizationStore } from "./store.js";
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
import { intervalsOverlap, isActive } from "./validation.js";

class MemoryOrganizationStore implements OrganizationStore {
  readonly #assignments = new Map<string, Assignment>();
  readonly #associations = new Map<string, SubjectAssociation>();
  readonly #employments = new Map<string, Employment>();
  readonly #operations = new Map<string, string>();
  readonly #placements = new Map<string, OrganizationUnitPlacement>();
  readonly #positions = new Map<string, Position>();
  readonly #units = new Map<string, OrganizationUnit>();
  readonly #people = new Map<string, WorkforcePerson>();

  commit(command: OrganizationCommit): Promise<OrganizationCommitResult> {
    const prior = this.#operations.get(command.operationId);
    if (prior !== undefined) {
      if (prior !== command.fingerprint) throw new OrganizationError("idempotency_conflict");
      return Promise.resolve({ replayed: true });
    }

    const write = command.write;
    if (write.kind === "create_person") this.#insert(this.#people, write.person.workforcePersonId, write.person);
    if (write.kind === "create_employment") this.#insert(this.#employments, write.employment.employmentId, write.employment);
    if (write.kind === "create_organization_unit") {
      this.#assertAbsent(this.#units, write.unit.organizationUnitId);
      this.#assertAbsent(this.#placements, write.placement.placementId);
      this.#insert(this.#units, write.unit.organizationUnitId, write.unit);
      this.#insert(this.#placements, write.placement.placementId, write.placement);
    }
    if (write.kind === "create_organization_unit_placement") this.#insert(this.#placements, write.placement.placementId, write.placement);
    if (write.kind === "create_position") this.#insert(this.#positions, write.position.positionId, write.position);
    if (write.kind === "create_assignment") this.#insert(this.#assignments, write.assignment.assignmentId, write.assignment);
    if (write.kind === "create_subject_association") {
      for (const association of this.#associations.values()) {
        const sameSubject = association.issuer === write.association.issuer && association.subject === write.association.subject;
        const samePerson = association.workforcePersonId === write.association.workforcePersonId;
        if ((sameSubject || samePerson) && intervalsOverlap(association, write.association)) {
          throw new OrganizationError("conflicting_subject_association");
        }
      }
      this.#insert(this.#associations, write.association.associationId, write.association);
    }
    if (write.kind === "close_assignment") this.#close(this.#assignments, write.factId, write.effectiveTo);
    if (write.kind === "close_employment") this.#close(this.#employments, write.factId, write.effectiveTo);
    if (write.kind === "close_organization_unit_placement") this.#close(this.#placements, write.factId, write.effectiveTo);
    if (write.kind === "close_subject_association") this.#close(this.#associations, write.factId, write.effectiveTo);
    this.#operations.set(command.operationId, command.fingerprint);
    return Promise.resolve({ replayed: false });
  }

  findAssignment(id: string): Promise<Assignment | undefined> { return Promise.resolve(this.#assignments.get(id)); }
  findEmployment(id: string): Promise<Employment | undefined> { return Promise.resolve(this.#employments.get(id)); }
  findOrganizationUnit(id: string): Promise<OrganizationUnit | undefined> { return Promise.resolve(this.#units.get(id)); }
  findOrganizationUnitPlacement(id: string): Promise<OrganizationUnitPlacement | undefined> { return Promise.resolve(this.#placements.get(id)); }
  findPosition(id: string): Promise<Position | undefined> { return Promise.resolve(this.#positions.get(id)); }
  findSubjectAssociation(id: string): Promise<SubjectAssociation | undefined> { return Promise.resolve(this.#associations.get(id)); }
  findWorkforcePerson(id: string): Promise<WorkforcePerson | undefined> { return Promise.resolve(this.#people.get(id)); }

  listActiveAssignments(id: string, at: string): Promise<readonly Assignment[]> {
    return Promise.resolve([...this.#assignments.values()].filter((item) => item.workforcePersonId === id && isActive(item, at)));
  }

  listActiveEmployments(id: string, at: string): Promise<readonly Employment[]> {
    return Promise.resolve([...this.#employments.values()].filter((item) => item.workforcePersonId === id && isActive(item, at)));
  }

  listActivePlacements(id: string, at: string): Promise<readonly OrganizationUnitPlacement[]> {
    return Promise.resolve([...this.#placements.values()].filter((item) => item.organizationUnitId === id && isActive(item, at)));
  }

  listPlacementChangeTimes(from: string, to?: string): Promise<readonly string[]> {
    const fromTime = Date.parse(from);
    const toTime = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
    return Promise.resolve([...new Set([...this.#placements.values()]
      .map(({ effectiveFrom }) => effectiveFrom)
      .filter((value) => Date.parse(value) > fromTime && Date.parse(value) < toTime))].sort());
  }

  listActiveSubjectAssociations(subject: AuthenticationSubject, at: string): Promise<readonly SubjectAssociation[]> {
    return Promise.resolve([...this.#associations.values()].filter((item) => item.issuer === subject.issuer && item.subject === subject.subject && isActive(item, at)));
  }

  #close<T extends { readonly effectiveFrom: string; readonly effectiveTo?: string }>(records: Map<string, T>, id: string, to: string): void {
    const current = records.get(id);
    if (!current) throw new OrganizationError("entity_not_found");
    if (Date.parse(to) <= Date.parse(current.effectiveFrom) || (current.effectiveTo && current.effectiveTo !== to)) {
      throw new OrganizationError("effective_interval_invalid");
    }
    records.set(id, { ...current, effectiveTo: to });
  }

  #insert<T>(records: Map<string, T>, id: string, value: T): void {
    this.#assertAbsent(records, id);
    records.set(id, value);
  }

  #assertAbsent<T>(records: Map<string, T>, id: string): void {
    if (records.has(id)) throw new OrganizationError("entity_conflict");
  }
}

export function createMemoryOrganizationStore(): OrganizationStore {
  return new MemoryOrganizationStore();
}
