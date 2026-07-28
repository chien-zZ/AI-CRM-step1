import type {
  AuthorizationSubjectContext,
  DataScope,
  DataScopeTerm,
  EffectiveRoleGrant,
  PermissionDeclaration,
  PermissionRequest,
  RoleDefinition,
  ScopeConstraint,
} from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const IDENTIFIER = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;
const ACTION = /^[a-z][a-z0-9-]*$/u;
const POLICY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const VALUE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,254}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** Locale-independent UTF-16 code-unit order for canonical policy material. */
export const compareCodeUnits = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

export class PolicyValidationError extends Error {
  public constructor() {
    super("AUTHORIZATION_POLICY_INVALID");
    this.name = "PolicyValidationError";
  }
}

const invalid = (): never => { throw new PolicyValidationError(); };
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const string = (value: unknown, pattern: RegExp, maximum: number): string =>
  typeof value === "string" && value.length <= maximum && pattern.test(value) ? value : invalid();
const uuid = (value: unknown): string => string(value, UUID, 36).toLowerCase();

const timestamp = (value: unknown): Date => {
  const raw = string(value, TIMESTAMP, 24);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== raw) invalid();
  return parsed;
};

const uniqueStrings = (
  value: unknown,
  pattern: RegExp,
  maximumItems: number,
  maximumLength: number,
): readonly string[] => {
  if (!Array.isArray(value) || value.length > maximumItems) invalid();
  const entries = value as unknown[];
  const result = entries.map((entry: unknown) => string(entry, pattern, maximumLength));
  if (new Set(result).size !== result.length) invalid();
  return Object.freeze(result.sort());
};

const normalizeScope = (value: unknown, dimensions: readonly string[]): Readonly<DataScope> => {
  if (!isRecord(value) || !exactKeys(value, ["terms", "version"]) || value["version"] !== 1) invalid();
  const scopeRecord = value as Record<string, unknown>;
  const rawTerms = scopeRecord["terms"];
  if (!Array.isArray(rawTerms) || rawTerms.length === 0 || rawTerms.length > 128) invalid();
  const termEntries = rawTerms as unknown[];
  const dimensionSet = new Set(dimensions);
  const terms: DataScopeTerm[] = termEntries.map((term: unknown): DataScopeTerm => {
    if (!isRecord(term) || typeof term["kind"] !== "string") invalid();
    const termRecord = term as Record<string, unknown>;
    if (termRecord["kind"] === "all") {
      if (!exactKeys(termRecord, ["kind"])) invalid();
      return Object.freeze({ kind: "all" as const });
    }
    if (termRecord["kind"] !== "match" || !exactKeys(termRecord, ["constraints", "kind"])) invalid();
    const rawConstraints = termRecord["constraints"];
    if (!Array.isArray(rawConstraints) || rawConstraints.length === 0 || rawConstraints.length > 32) invalid();
    const constraintEntries = rawConstraints as unknown[];
    const constraints: Readonly<ScopeConstraint>[] = constraintEntries.map((constraint: unknown): Readonly<ScopeConstraint> => {
      if (!isRecord(constraint) || !exactKeys(constraint, ["dimension", "values"])) invalid();
      const constraintRecord = constraint as Record<string, unknown>;
      const dimension = string(constraintRecord["dimension"], IDENTIFIER, 128);
      if (!dimensionSet.has(dimension)) invalid();
      const values = uniqueStrings(constraintRecord["values"], VALUE, 256, 255);
      if (values.length === 0) invalid();
      return Object.freeze({ dimension, values });
    }).sort((left, right) => compareCodeUnits(left.dimension, right.dimension));
    if (new Set(constraints.map(({ dimension }) => dimension)).size !== constraints.length ||
      constraints.length !== dimensions.length) invalid();
    return Object.freeze({ constraints: Object.freeze(constraints), kind: "match" as const });
  });
  if (terms.some(({ kind }) => kind === "all")) {
    return Object.freeze({ terms: Object.freeze([{ kind: "all" as const }]), version: 1 as const });
  }
  const deduplicated = [...new Map(terms.map((term) => [JSON.stringify(term), term])).values()]
    .sort((left, right) => compareCodeUnits(JSON.stringify(left), JSON.stringify(right)));
  return Object.freeze({ terms: Object.freeze(deduplicated), version: 1 as const });
};

export interface ValidatedGrant extends Omit<EffectiveRoleGrant, "validFrom" | "validTo"> {
  readonly validFrom: Date;
  readonly validTo?: Date;
}

export interface ValidatedPolicy {
  readonly grants: readonly ValidatedGrant[];
  readonly permissions: ReadonlyMap<string, Readonly<PermissionDeclaration>>;
  readonly roles: ReadonlyMap<string, Readonly<RoleDefinition>>;
  readonly version: string;
}

export const validatePolicySnapshot = (value: unknown, expectedVersion: string): ValidatedPolicy => {
  if (!isRecord(value) || !exactKeys(value, ["grants", "permissions", "roles", "version"])) invalid();
  const snapshotRecord = value as Record<string, unknown>;
  const rawPermissions = snapshotRecord["permissions"];
  const rawRoles = snapshotRecord["roles"];
  const rawGrants = snapshotRecord["grants"];
  if (!Array.isArray(rawPermissions) || rawPermissions.length > 10_000 ||
    !Array.isArray(rawRoles) || rawRoles.length > 10_000 ||
    !Array.isArray(rawGrants) || rawGrants.length > 100_000) invalid();
  const permissionEntries = rawPermissions as unknown[];
  const roleEntries = rawRoles as unknown[];
  const grantEntries = rawGrants as unknown[];
  const version = string(snapshotRecord["version"], POLICY_VERSION, 128);
  if (version !== expectedVersion) invalid();

  const permissions = new Map<string, Readonly<PermissionDeclaration>>();
  const pairs = new Set<string>();
  for (const entry of permissionEntries) {
    if (!isRecord(entry) || !exactKeys(entry, ["action", "code", "resource", "scopeDimensions"])) invalid();
    const permissionRecord = entry as Record<string, unknown>;
    const resource = string(permissionRecord["resource"], IDENTIFIER, 128);
    const action = string(permissionRecord["action"], ACTION, 64);
    const code = string(permissionRecord["code"], /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+:[a-z][a-z0-9-]*$/u, 193);
    if (code !== `${resource}:${action}` || permissions.has(code) || pairs.has(`${resource}\0${action}`)) invalid();
    const scopeDimensions = uniqueStrings(permissionRecord["scopeDimensions"], IDENTIFIER, 32, 128);
    const permission = Object.freeze({ action, code, resource, scopeDimensions });
    permissions.set(code, permission);
    pairs.add(`${resource}\0${action}`);
  }

  const roles = new Map<string, Readonly<RoleDefinition>>();
  for (const entry of roleEntries) {
    if (!isRecord(entry) || !exactKeys(entry, ["permissions", "roleId"]) ||
      !Array.isArray(entry["permissions"]) || entry["permissions"].length === 0 ||
      entry["permissions"].length > 1_000) invalid();
    const roleRecord = entry as Record<string, unknown>;
    const roleId = uuid(roleRecord["roleId"]);
    if (roles.has(roleId)) invalid();
    const seen = new Set<string>();
    const rawBindings = roleRecord["permissions"] as unknown[];
    const bindings = rawBindings.map((binding: unknown) => {
      if (!isRecord(binding) || !exactKeys(binding, ["permissionCode", "scope"])) invalid();
      const bindingRecord = binding as Record<string, unknown>;
      const permissionCode = string(bindingRecord["permissionCode"], /^[a-z].+:[a-z][a-z0-9-]*$/u, 193);
      const permission = permissions.get(permissionCode);
      if (permission === undefined) throw new PolicyValidationError();
      if (seen.has(permissionCode)) invalid();
      seen.add(permissionCode);
      return Object.freeze({ permissionCode, scope: normalizeScope(bindingRecord["scope"], permission.scopeDimensions) });
    });
    roles.set(roleId, Object.freeze({ permissions: Object.freeze(bindings), roleId }));
  }

  const grantIds = new Set<string>();
  const grants = grantEntries.map((entry: unknown): Readonly<ValidatedGrant> => {
    if (!isRecord(entry) || ![4, 5].includes(Object.keys(entry).length) ||
      !["grantId", "roleId", "subject", "validFrom"].every((key) => key in entry) ||
      Object.keys(entry).some((key) => !["grantId", "roleId", "subject", "validFrom", "validTo"].includes(key))) invalid();
    const grantRecord = entry as Record<string, unknown>;
    const grantId = uuid(grantRecord["grantId"]);
    const roleId = uuid(grantRecord["roleId"]);
    if (grantIds.has(grantId) || !roles.has(roleId) || !isRecord(grantRecord["subject"])) invalid();
    grantIds.add(grantId);
    const subject = grantRecord["subject"] as Record<string, unknown>;
    const normalizedSubject = subject["kind"] === "workforce_person" && exactKeys(subject, ["kind", "workforcePersonId"])
      ? Object.freeze({ kind: "workforce_person" as const, workforcePersonId: uuid(subject["workforcePersonId"]) })
      : subject["kind"] === "assignment" && exactKeys(subject, ["assignmentId", "kind"])
        ? Object.freeze({ assignmentId: uuid(subject["assignmentId"]), kind: "assignment" as const })
        : invalid();
    const validFrom = timestamp(grantRecord["validFrom"]);
    const validTo = grantRecord["validTo"] === undefined ? undefined : timestamp(grantRecord["validTo"]);
    if (validTo !== undefined && validTo <= validFrom) invalid();
    return Object.freeze({ grantId, roleId, subject: normalizedSubject, validFrom,
      ...(validTo === undefined ? {} : { validTo }) });
  });
  return Object.freeze({ grants: Object.freeze(grants), permissions, roles, version });
};

export const validateSubjectContext = (value: unknown): Readonly<AuthorizationSubjectContext> | undefined => {
  if (!isRecord(value) || typeof value["workforcePersonId"] !== "string" || !UUID.test(value["workforcePersonId"]) ||
    !Array.isArray(value["activeAssignmentIds"])) return undefined;
  const activeAssignmentIds = value["activeAssignmentIds"]
    .filter((id): id is string => typeof id === "string")
    .map((id) => id.toLowerCase());
  const rawSelectedAssignmentId = value["selectedAssignmentId"];
  const selectedAssignmentId = typeof rawSelectedAssignmentId === "string" ? rawSelectedAssignmentId.toLowerCase() : rawSelectedAssignmentId;
  if (activeAssignmentIds.length !== value["activeAssignmentIds"].length || activeAssignmentIds.length > 128 ||
    activeAssignmentIds.some((id) => !UUID.test(id)) || new Set(activeAssignmentIds).size !== activeAssignmentIds.length ||
    (selectedAssignmentId !== undefined && (typeof selectedAssignmentId !== "string" ||
      !UUID.test(selectedAssignmentId) || !activeAssignmentIds.includes(selectedAssignmentId)))) return undefined;
  return Object.freeze({
    activeAssignmentIds: Object.freeze([...activeAssignmentIds].sort()),
    ...(selectedAssignmentId === undefined ? {} : { selectedAssignmentId }),
    workforcePersonId: value["workforcePersonId"].toLowerCase(),
  });
};

export const validatePermissionRequest = (value: unknown): Readonly<PermissionRequest> | undefined => {
  if (!isRecord(value) || typeof value["resource"] !== "string" || typeof value["action"] !== "string" ||
    !IDENTIFIER.test(value["resource"]) || value["resource"].length > 128 ||
    !ACTION.test(value["action"]) || value["action"].length > 64) return undefined;
  if (value["resourceContext"] === undefined) return Object.freeze({ action: value["action"], resource: value["resource"] });
  if (!isRecord(value["resourceContext"]) || Object.keys(value["resourceContext"]).length > 32) return undefined;
  const entries = Object.entries(value["resourceContext"]);
  if (entries.some(([dimension, item]) => !IDENTIFIER.test(dimension) || dimension.length > 128 ||
    typeof item !== "string" || !VALUE.test(item))) return undefined;
  const resourceContext: Record<string, string> = {};
  for (const [dimension, item] of entries) {
    if (typeof item === "string") resourceContext[dimension] = item;
  }
  return Object.freeze({
    action: value["action"], resource: value["resource"],
    resourceContext: Object.freeze(Object.fromEntries(
      Object.entries(resourceContext).sort(([left], [right]) => compareCodeUnits(left, right)),
    )),
  });
};

export const policyVersion = (value: unknown): string => string(value, POLICY_VERSION, 128);
