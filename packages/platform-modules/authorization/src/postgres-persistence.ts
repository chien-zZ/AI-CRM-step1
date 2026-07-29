import { createHash } from "node:crypto";

import { AuthorizationPersistenceError } from "./errors.js";
import { compareCodeUnits, PolicyValidationError, policyVersion, validatePolicySnapshot } from "./policy.js";
import type {
  AuthorizationDecisionRecord,
  AuthorizationDecisionRecorder,
  AuthorizationPersistenceRuntime,
  AuthorizationPolicyPublication,
  AuthorizationPolicyPublisher,
  AuthorizationPolicySnapshot,
  AuthorizationPolicyStore,
  PublishAuthorizationPolicyCommand,
} from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DIGEST = /^[0-9a-f]{64}$/u;
const SUPPORTED_CONTRACT_VERSION = "authorization-policy.v1";
const UNAVAILABLE_POLICY_VERSION = "unavailable";
const TRACE_ID = /^[0-9a-f]{32}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

interface PolicyRow { readonly content_digest: string; readonly contract_version?: string; readonly snapshot: unknown; readonly version: string }
interface CurrentRow { readonly content_digest: string; readonly contract_version?: string; readonly version: string }
interface PublicationRow { readonly fingerprint: string; readonly result: unknown }
interface DecisionRow { readonly record_digest: string }

const fail = (code: ConstructorParameters<typeof AuthorizationPersistenceError>[0]): never => {
  throw new AuthorizationPersistenceError(code);
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const iso = (value: unknown): string => {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) return fail("authorization_policy_invalid");
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) return fail("authorization_policy_invalid");
  return value;
};
const uuid = (value: unknown, error: "authorization_decision_conflict" | "authorization_policy_invalid"): string =>
  typeof value === "string" && UUID.test(value) ? value.toLowerCase() : fail(error);

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  return value;
};
const canonicalJson = (value: unknown): string => JSON.stringify(canonicalValue(value));
const digest = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");

export const canonicalizeAuthorizationPolicy = (snapshot: AuthorizationPolicySnapshot): AuthorizationPolicySnapshot => {
  let validated: ReturnType<typeof validatePolicySnapshot>;
  try { validated = validatePolicySnapshot(snapshot, policyVersion(snapshot.version)); }
  catch { return fail("authorization_policy_invalid"); }
  if (validated.permissions.size === 0 || validated.roles.size === 0 || validated.grants.length === 0) {
    return fail("authorization_policy_invalid");
  }
  const permissions = [...validated.permissions.values()]
    .map((permission) => ({ ...permission, scopeDimensions: [...permission.scopeDimensions] }))
    .sort((left, right) => compareCodeUnits(left.code, right.code));
  const roles = [...validated.roles.values()].map((role) => ({
    roleId: role.roleId,
    permissions: [...role.permissions].map((binding) => ({
      permissionCode: binding.permissionCode,
      scope: {
        terms: binding.scope.terms.map((term) => term.kind === "all" ? { kind: "all" as const } : ({
          constraints: term.constraints.map((constraint) => ({
            dimension: constraint.dimension, values: [...constraint.values],
          })).sort((left, right) => compareCodeUnits(left.dimension, right.dimension)),
          kind: "match" as const,
        })).sort((left, right) => compareCodeUnits(canonicalJson(left), canonicalJson(right))),
        version: 1 as const,
      },
    })).sort((left, right) => compareCodeUnits(left.permissionCode, right.permissionCode)),
  })).sort((left, right) => compareCodeUnits(left.roleId, right.roleId));
  const grants = validated.grants.map((grant) => ({
    grantId: grant.grantId,
    roleId: grant.roleId,
    subject: grant.subject,
    validFrom: grant.validFrom.toISOString(),
    ...(grant.validTo === undefined ? {} : { validTo: grant.validTo.toISOString() }),
  })).sort((left, right) => compareCodeUnits(left.grantId, right.grantId));
  return Object.freeze({ grants: Object.freeze(grants), permissions: Object.freeze(permissions), roles: Object.freeze(roles), version: validated.version });
};

export const authorizationPolicyDigest = (snapshot: AuthorizationPolicySnapshot): string =>
  digest(canonicalizeAuthorizationPolicy(snapshot));

const publicationResult = (value: unknown, replayed: boolean): AuthorizationPolicyPublication => {
  if (!record(value) || typeof value["contentDigest"] !== "string" || !DIGEST.test(value["contentDigest"]) ||
    typeof value["publicationId"] !== "string" || !UUID.test(value["publicationId"]) ||
    typeof value["version"] !== "string" || typeof value["publishedAt"] !== "string" ||
    (value["previousVersion"] !== undefined && typeof value["previousVersion"] !== "string")) {
    return fail("authorization_persistence_unavailable");
  }
  return {
    contentDigest: value["contentDigest"],
    ...(value["previousVersion"] === undefined ? {} : { previousVersion: value["previousVersion"] }),
    publicationId: value["publicationId"].toLowerCase(), publishedAt: value["publishedAt"], replayed,
    version: value["version"],
  };
};

class PostgresAuthorizationPolicyStore implements AuthorizationPolicyStore {
  public constructor(private readonly runtime: AuthorizationPersistenceRuntime) {}
  public async currentVersion(): Promise<string> {
    try {
      const row = (await this.runtime.execute<CurrentRow>(
        "select c.version,c.content_digest,v.contract_version from authorization_core.current_policy c join authorization_core.policy_versions v on v.version=c.version and v.content_digest=c.content_digest join authorization_core.policy_publications p on p.publication_id=c.publication_id and p.policy_version=c.version where c.singleton=true",
      )).rows[0];
      if (!row || row.contract_version !== SUPPORTED_CONTRACT_VERSION || !DIGEST.test(row.content_digest)) {
        return fail("authorization_persistence_unavailable");
      }
      return policyVersion(row.version);
    } catch (error) {
      if (error instanceof AuthorizationPersistenceError) throw error;
      return fail("authorization_persistence_unavailable");
    }
  }
  public async load(versionInput: string): Promise<unknown> {
    try {
      const version = policyVersion(versionInput);
      const row = (await this.runtime.execute<PolicyRow>(
        "select v.version,v.contract_version,v.content_digest,v.snapshot from authorization_core.policy_versions v where v.version=$1 and exists(select 1 from authorization_core.policy_publications p where p.policy_version=v.version)", [version],
      )).rows[0];
      if (!row || row.version !== version || row.contract_version !== SUPPORTED_CONTRACT_VERSION ||
        !DIGEST.test(row.content_digest) || !record(row.snapshot)) {
        return fail("authorization_persistence_unavailable");
      }
      const normalized = canonicalizeAuthorizationPolicy(row.snapshot as unknown as AuthorizationPolicySnapshot);
      if (digest(normalized) !== row.content_digest) return fail("authorization_persistence_unavailable");
      return normalized;
    } catch (error) {
      if (error instanceof AuthorizationPersistenceError && error.code !== "authorization_policy_invalid") throw error;
      if (error instanceof AuthorizationPersistenceError) return fail("authorization_persistence_unavailable");
      if (error instanceof PolicyValidationError) return fail("authorization_persistence_unavailable");
      return fail("authorization_persistence_unavailable");
    }
  }
}

class PostgresAuthorizationPolicyPublisher implements AuthorizationPolicyPublisher {
  public constructor(private readonly runtime: AuthorizationPersistenceRuntime) {}
  public publish(command: PublishAuthorizationPolicyCommand): Promise<AuthorizationPolicyPublication> {
    let publicationId: string; let publishedAt: string; let contractVersion: string; let snapshot: AuthorizationPolicySnapshot;
    let expectedPreviousVersion: string | null | undefined;
    try {
      publicationId = uuid(command.publicationId, "authorization_policy_invalid");
      publishedAt = iso(command.publishedAt);
      contractVersion = command.contractVersion === SUPPORTED_CONTRACT_VERSION
        ? command.contractVersion : fail("authorization_policy_invalid");
      expectedPreviousVersion = command.expectedPreviousVersion === undefined || command.expectedPreviousVersion === null
        ? command.expectedPreviousVersion
        : policyVersion(command.expectedPreviousVersion);
      snapshot = canonicalizeAuthorizationPolicy(command.snapshot);
    } catch (error) {
      return Promise.reject(error instanceof AuthorizationPersistenceError ? error : new AuthorizationPersistenceError("authorization_policy_invalid"));
    }
    const contentDigest = digest(snapshot);
    const fingerprint = digest({ contentDigest, contractVersion, publishedAt, version: snapshot.version,
      ...(expectedPreviousVersion === undefined ? {} : { expectedPreviousVersion }) });
    let transaction: Promise<AuthorizationPolicyPublication>;
    try { transaction = this.runtime.withTransaction(async () => {
      try {
        await this.runtime.execute("select pg_advisory_xact_lock(hashtextextended('authorization.policy.publication',0))");
        const prior = (await this.runtime.execute<PublicationRow>(
          "select fingerprint,result from authorization_core.policy_publications where publication_id=$1 for update", [publicationId],
        )).rows[0];
        if (prior) {
          if (prior.fingerprint !== fingerprint) return fail("authorization_policy_conflict");
          return publicationResult(prior.result, true);
        }
        const existing = (await this.runtime.execute<PolicyRow>(
          "select version,contract_version,content_digest,snapshot from authorization_core.policy_versions where version=$1 for update", [snapshot.version],
        )).rows[0];
        if (existing && (existing.contract_version !== contractVersion || existing.content_digest !== contentDigest || canonicalJson(existing.snapshot) !== canonicalJson(snapshot))) {
          return fail("authorization_policy_conflict");
        }
        if (!existing) await this.runtime.execute(
          "insert into authorization_core.policy_versions(version,contract_version,content_digest,snapshot,created_at) values($1,$2,$3,$4::jsonb,$5)",
          [snapshot.version, contractVersion, contentDigest, JSON.stringify(snapshot), publishedAt],
        );
        const current = (await this.runtime.execute<CurrentRow>(
          "select version,content_digest from authorization_core.current_policy where singleton=true for update",
        )).rows[0];
        if ((expectedPreviousVersion === null && current !== undefined) ||
          (typeof expectedPreviousVersion === "string" && current?.version !== expectedPreviousVersion)) {
          return fail("authorization_policy_conflict");
        }
        const result: Omit<AuthorizationPolicyPublication, "replayed"> = {
          contentDigest, ...(current === undefined ? {} : { previousVersion: current.version }), publicationId,
          publishedAt, version: snapshot.version,
        };
        await this.runtime.execute(
          "insert into authorization_core.policy_publications(publication_id,fingerprint,policy_version,content_digest,published_at,previous_policy_version,result) values($1,$2,$3,$4,$5,$6,$7::jsonb)",
          [publicationId, fingerprint, snapshot.version, contentDigest, publishedAt, current?.version ?? null, JSON.stringify(result)],
        );
        await this.runtime.execute(
          "insert into authorization_core.current_policy(singleton,version,content_digest,publication_id,updated_at) values(true,$1,$2,$3,$4) on conflict(singleton) do update set version=excluded.version,content_digest=excluded.content_digest,publication_id=excluded.publication_id,updated_at=excluded.updated_at",
          [snapshot.version, contentDigest, publicationId, publishedAt],
        );
        const readback = (await this.runtime.execute<PolicyRow>(
          "select version,content_digest,snapshot from authorization_core.policy_versions where version=$1", [snapshot.version],
        )).rows[0];
        if (!readback || readback.content_digest !== contentDigest || digest(canonicalizeAuthorizationPolicy(readback.snapshot as AuthorizationPolicySnapshot)) !== contentDigest) {
          return fail("authorization_persistence_unavailable");
        }
        return { ...result, replayed: false };
      } catch (error) {
        if (error instanceof AuthorizationPersistenceError) throw error;
        const code = (error as { code?: unknown }).code;
        if (["23505", "23514", "55000"].includes(String(code))) return fail("authorization_policy_conflict");
        return fail("authorization_persistence_unavailable");
      }
    }); } catch { return Promise.reject(new AuthorizationPersistenceError("authorization_persistence_unavailable")); }
    return transaction.catch((error: unknown) => {
      if (error instanceof AuthorizationPersistenceError) throw error;
      return fail("authorization_persistence_unavailable");
    });
  }
}

class PostgresAuthorizationDecisionRecorder implements AuthorizationDecisionRecorder {
  public constructor(private readonly runtime: AuthorizationPersistenceRuntime) {}
  public async record(input: AuthorizationDecisionRecord): Promise<void> {
    const decisionId = uuid(input.decisionId, "authorization_decision_conflict");
    const operations = new Set(["batch_check", "check", "resolve_data_scope"]);
    const reasons = new Set(["allowed", "unknown_permission", "no_applicable_grant", "invalid_context", "resource_context_required", "scope_mismatch", "policy_unavailable", "policy_invalid"]);
    const evaluatedDate = new Date(input.evaluatedAt);
    const evaluatedAtValid = TIMESTAMP.test(input.evaluatedAt) && !Number.isNaN(evaluatedDate.getTime()) && evaluatedDate.toISOString() === input.evaluatedAt;
    if (!TRACE_ID.test(input.traceId) || !evaluatedAtValid ||
      !operations.has(input.operation) || !reasons.has(input.reason) || typeof input.allowed !== "boolean" ||
      !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u.test(input.resource) || input.resource.length > 128 ||
      !/^[a-z][a-z0-9-]*$/u.test(input.action) || input.action.length > 64 ||
      input.permissionCode !== `${input.resource}:${input.action}` || input.permissionCode.length > 193 ||
      input.allowed !== (input.reason === "allowed")) return fail("authorization_decision_conflict");
    try { policyVersion(input.policyVersion); } catch { return fail("authorization_decision_conflict"); }
    const normalized = { ...input, decisionId, ...(input.selectedAssignmentId === undefined ? {} : { selectedAssignmentId: uuid(input.selectedAssignmentId, "authorization_decision_conflict") }), ...(input.workforcePersonId === undefined ? {} : { workforcePersonId: uuid(input.workforcePersonId, "authorization_decision_conflict") }) };
    const recordDigest = digest(normalized);
    try {
      const unavailableReason = normalized.reason === "policy_unavailable" || normalized.reason === "policy_invalid" ||
        normalized.reason === "invalid_context";
      if (normalized.policyVersion === UNAVAILABLE_POLICY_VERSION) {
        if (normalized.allowed || !unavailableReason) return fail("authorization_decision_conflict");
      } else {
        await new PostgresAuthorizationPolicyStore(this.runtime).load(normalized.policyVersion);
      }
      const inserted = await this.runtime.execute<DecisionRow>(
        "insert into authorization_core.decision_records(decision_id,record_digest,evaluated_at,operation,resource,action,permission_code,allowed,reason,policy_version,workforce_person_id,selected_assignment_id,trace_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict(decision_id) do nothing returning record_digest",
        [decisionId, recordDigest, normalized.evaluatedAt, normalized.operation, normalized.resource, normalized.action, normalized.permissionCode, normalized.allowed, normalized.reason, normalized.policyVersion, normalized.workforcePersonId ?? null, normalized.selectedAssignmentId ?? null, normalized.traceId],
      );
      if (inserted.rowCount === 1) return;
      const existing = (await this.runtime.execute<DecisionRow>(
        "select record_digest from authorization_core.decision_records where decision_id=$1", [decisionId],
      )).rows[0];
      if (!existing || existing.record_digest !== recordDigest) return fail("authorization_decision_conflict");
    } catch (error) {
      if (error instanceof AuthorizationPersistenceError) throw error;
      return fail("authorization_persistence_unavailable");
    }
  }
}

export interface PostgresAuthorizationPersistence {
  readonly publisher: AuthorizationPolicyPublisher;
  readonly recorder: AuthorizationDecisionRecorder;
  readonly store: AuthorizationPolicyStore;
}

export function createPostgresAuthorizationPersistence(runtime: AuthorizationPersistenceRuntime): PostgresAuthorizationPersistence {
  return {
    publisher: new PostgresAuthorizationPolicyPublisher(runtime),
    recorder: new PostgresAuthorizationDecisionRecorder(runtime),
    store: new PostgresAuthorizationPolicyStore(runtime),
  };
}
