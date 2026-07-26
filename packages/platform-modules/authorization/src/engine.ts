import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { AuthorizationDeniedError, AuthorizationUnavailableError } from "./errors.js";
import {
  PolicyValidationError,
  policyVersion,
  validatePermissionRequest,
  validatePolicySnapshot,
  validateSubjectContext,
  type ValidatedGrant,
  type ValidatedPolicy,
} from "./policy.js";
import type {
  AuthorizationCache,
  AuthorizationDecision,
  AuthorizationDecisionRecorder,
  AuthorizationObserver,
  AuthorizationPolicyStore,
  AuthorizationService,
  AuthorizationServiceOptions,
  AuthorizationSubjectContext,
  CachedAuthorizationEvaluation,
  DataScope,
  DataScopeResolution,
  DataScopeTerm,
  PermissionDeclaration,
  PermissionRequest,
} from "./types.js";

const UNAVAILABLE_VERSION = "unavailable";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TRACE_ID = /^(?!0{32})[0-9a-f]{32}$/u;

const recordSafely = (observer: AuthorizationObserver | undefined, event: Parameters<AuthorizationObserver["record"]>[0]): void => {
  try {
    observer?.record(event);
  } catch {
    // Technical telemetry cannot change the authorization result.
  }
};

const permissionCode = (request: Pick<PermissionRequest, "action" | "resource">): string =>
  `${request.resource}:${request.action}`;

const isActive = (grant: ValidatedGrant, at: Date): boolean =>
  grant.validFrom <= at && (grant.validTo === undefined || at < grant.validTo);

const applicableGrant = (
  grant: ValidatedGrant,
  subject: Readonly<AuthorizationSubjectContext>,
  at: Date,
): boolean => isActive(grant, at) && (grant.subject.kind === "workforce_person"
  ? grant.subject.workforcePersonId === subject.workforcePersonId
  : subject.selectedAssignmentId !== undefined && grant.subject.assignmentId === subject.selectedAssignmentId);

const normalizeCombinedScope = (terms: readonly DataScopeTerm[]): Readonly<DataScope> => {
  if (terms.some(({ kind }) => kind === "all")) {
    return Object.freeze({ terms: Object.freeze([{ kind: "all" as const }]), version: 1 as const });
  }
  const unique = [...new Map(terms.map((term) => [JSON.stringify(term), term])).values()]
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return Object.freeze({ terms: Object.freeze(unique), version: 1 as const });
};

const scopeMatches = (scope: DataScope, context: Readonly<Record<string, string>>): boolean =>
  scope.terms.some((term) => term.kind === "all" || term.constraints.every((constraint) =>
    constraint.values.includes(context[constraint.dimension] ?? "")));

const resourceContextIsComplete = (
  permission: PermissionDeclaration,
  context: Readonly<Record<string, string>>,
): boolean => {
  const declared = [...permission.scopeDimensions].sort();
  const provided = Object.keys(context).sort();
  return declared.length === provided.length && declared.every((dimension, index) => dimension === provided[index]);
};

const evaluatePolicy = (
  policy: ValidatedPolicy,
  subject: Readonly<AuthorizationSubjectContext>,
  request: Readonly<PermissionRequest>,
  at: Date,
  operation: "check" | "resolve_data_scope",
): CachedAuthorizationEvaluation => {
  const code = permissionCode(request);
  const permission = policy.permissions.get(code);
  if (permission === undefined) {
    return { allowed: false, policyVersion: policy.version, reason: "unknown_permission" };
  }
  if (operation === "check") {
    if (permission.scopeDimensions.length > 0 && request.resourceContext === undefined) {
      return { allowed: false, policyVersion: policy.version, reason: "resource_context_required" };
    }
    if (request.resourceContext !== undefined && !resourceContextIsComplete(permission, request.resourceContext)) {
      return { allowed: false, policyVersion: policy.version, reason: "invalid_context" };
    }
  }

  const scopes = policy.grants.flatMap((grant) => {
    if (!applicableGrant(grant, subject, at)) return [];
    const role = policy.roles.get(grant.roleId);
    const binding = role?.permissions.find((candidate) => candidate.permissionCode === code);
    return binding === undefined ? [] : [binding.scope];
  });
  if (scopes.length === 0) {
    return { allowed: false, policyVersion: policy.version, reason: "no_applicable_grant" };
  }
  const scope = normalizeCombinedScope(scopes.flatMap(({ terms }) => terms));
  if (operation === "check" && request.resourceContext !== undefined && !scopeMatches(scope, request.resourceContext)) {
    return { allowed: false, policyVersion: policy.version, reason: "scope_mismatch" };
  }
  return { allowed: true, policyVersion: policy.version, reason: "allowed", scope };
};

const cacheKey = (
  operation: "check" | "resolve_data_scope",
  policyVersionValue: string,
  subject: Readonly<AuthorizationSubjectContext>,
  request: Readonly<PermissionRequest>,
): string => createHash("sha256").update(JSON.stringify({ operation, policyVersionValue, request, subject })).digest("hex");

const nextPolicyBoundary = (policy: ValidatedPolicy, at: Date): Date | undefined => {
  const future = policy.grants.flatMap((grant) => [grant.validFrom, ...(grant.validTo === undefined ? [] : [grant.validTo])])
    .filter((value) => value > at);
  return future.length === 0 ? undefined : new Date(Math.min(...future.map((value) => value.getTime())));
};

const evaluationEqual = (left: CachedAuthorizationEvaluation, right: CachedAuthorizationEvaluation): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

interface EngineDependencies {
  readonly cache?: AuthorizationCache;
  readonly observer?: AuthorizationObserver;
  readonly recorder: AuthorizationDecisionRecorder;
  readonly store: AuthorizationPolicyStore;
}

export const createAuthorizationService = (
  dependencies: EngineDependencies,
  options: AuthorizationServiceOptions,
): AuthorizationService => {
  if (!Number.isInteger(options.cacheTtlSeconds) || options.cacheTtlSeconds < 1 || options.cacheTtlSeconds > 86_400 ||
    typeof options.traceId !== "function") {
    throw new TypeError("AUTHORIZATION_INVALID_CONFIGURATION");
  }
  const clock = options.clock ?? (() => new Date());
  const newDecisionId = options.decisionId ?? randomUUID;

  const decide = async (
    subjectInput: unknown,
    requestInput: unknown,
    operation: "batch_check" | "check" | "resolve_data_scope",
  ): Promise<{ readonly decision: Readonly<AuthorizationDecision>; readonly scope?: Readonly<DataScope> }> => {
    const startedAt = performance.now();
    let clockValue: unknown;
    try {
      clockValue = clock();
    } catch {
      clockValue = undefined;
    }
    const validClock = clockValue instanceof Date && !Number.isNaN(clockValue.getTime());
    const at: Date = clockValue instanceof Date ? clockValue : new Date(0);
    const evaluatedAt = validClock ? at.toISOString() : new Date(0).toISOString();
    const subject = validateSubjectContext(subjectInput);
    const request = validatePermissionRequest(requestInput);
    const resolveRequestContainsContext = operation === "resolve_data_scope" && request !== undefined &&
      Object.prototype.hasOwnProperty.call(requestInput, "resourceContext");
    let cacheStatus: "error" | "hit" | "miss" | "not_used" = "not_used";
    let evaluation: CachedAuthorizationEvaluation;

    if (!validClock) {
      evaluation = { allowed: false, policyVersion: UNAVAILABLE_VERSION, reason: "policy_unavailable" };
    } else if (subject === undefined || request === undefined || resolveRequestContainsContext) {
      evaluation = { allowed: false, policyVersion: UNAVAILABLE_VERSION, reason: "invalid_context" };
    } else {
      let version: string;
      let policy: ValidatedPolicy;
      try {
        version = policyVersion(await dependencies.store.currentVersion());
        policy = validatePolicySnapshot(await dependencies.store.load(version), version);
      } catch (error) {
        evaluation = {
          allowed: false,
          policyVersion: UNAVAILABLE_VERSION,
          reason: error instanceof PolicyValidationError ? "policy_invalid" : "policy_unavailable",
        };
        return finalize(evaluation, request, subject, operation, cacheStatus, startedAt, evaluatedAt);
      }
      const evaluationOperation = operation === "resolve_data_scope" ? operation : "check";
      const fresh = evaluatePolicy(policy, subject, request, at, evaluationOperation);
      const key = cacheKey(evaluationOperation, version, subject, request);
      if (dependencies.cache === undefined) {
        evaluation = fresh;
      } else {
        try {
          const cached = await dependencies.cache.get(key);
          if (cached !== undefined && evaluationEqual(cached, fresh)) {
            cacheStatus = "hit";
            evaluation = fresh;
          } else {
            cacheStatus = cached === undefined ? "miss" : "error";
            evaluation = fresh;
            const boundary = nextPolicyBoundary(policy, at);
            const ttl = boundary === undefined
              ? options.cacheTtlSeconds
              : Math.min(options.cacheTtlSeconds, Math.floor((boundary.getTime() - at.getTime()) / 1_000));
            if (ttl >= 1) await dependencies.cache.set(key, fresh, ttl, version);
          }
        } catch {
          cacheStatus = "error";
          evaluation = fresh;
        }
      }
    }
    return finalize(
      evaluation,
      request ?? Object.freeze({ action: "invalid", resource: "invalid.invalid" }),
      subject,
      operation,
      cacheStatus,
      startedAt,
      evaluatedAt,
    );
  };

  const finalize = async (
    evaluation: CachedAuthorizationEvaluation,
    request: Readonly<PermissionRequest>,
    subject: Readonly<AuthorizationSubjectContext> | undefined,
    operation: "batch_check" | "check" | "resolve_data_scope",
    cacheStatus: "error" | "hit" | "miss" | "not_used",
    startedAt: number,
    evaluatedAt: string,
  ): Promise<{ readonly decision: Readonly<AuthorizationDecision>; readonly scope?: Readonly<DataScope> }> => {
    let decisionId: unknown;
    try {
      decisionId = newDecisionId();
    } catch {
      throw new AuthorizationUnavailableError();
    }
    let traceId: string;
    try {
      traceId = options.traceId();
    } catch {
      throw new AuthorizationUnavailableError();
    }
    if (typeof decisionId !== "string" || !UUID.test(decisionId) || !TRACE_ID.test(traceId)) {
      throw new AuthorizationUnavailableError();
    }
    const decision = Object.freeze({
      allowed: evaluation.allowed,
      decisionId,
      evaluatedAt,
      policyVersion: evaluation.policyVersion,
      reason: evaluation.reason,
    });
    try {
      await dependencies.recorder.record({
        action: request.action,
        allowed: decision.allowed,
        decisionId: decision.decisionId,
        evaluatedAt,
        operation,
        permissionCode: permissionCode(request),
        policyVersion: decision.policyVersion,
        reason: decision.reason,
        resource: request.resource,
        ...(subject?.selectedAssignmentId === undefined ? {} : { selectedAssignmentId: subject.selectedAssignmentId }),
        traceId,
        ...(subject === undefined ? {} : { workforcePersonId: subject.workforcePersonId }),
      });
    } catch {
      throw new AuthorizationUnavailableError();
    }
    recordSafely(dependencies.observer, {
      cache: cacheStatus,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      operation,
      reason: decision.reason,
      status: decision.allowed ? "allowed" : "denied",
    });
    return evaluation.scope === undefined ? { decision } : { decision, scope: evaluation.scope };
  };

  const service: AuthorizationService = {
    async batchCheck(subject: AuthorizationSubjectContext, requests: readonly PermissionRequest[]) {
      if (!Array.isArray(requests) || requests.length > 256) throw new TypeError("AUTHORIZATION_BATCH_TOO_LARGE");
      const results = [];
      for (const request of requests as readonly unknown[]) {
        results.push((await decide(subject, request, "batch_check")).decision);
      }
      return Object.freeze(results);
    },
    async check(subject: AuthorizationSubjectContext, request: PermissionRequest) {
      return (await decide(subject, request, "check")).decision;
    },
    async invalidatePolicyVersion(version: string) {
      if (dependencies.cache === undefined) return;
      try {
        await dependencies.cache.invalidatePolicyVersion(policyVersion(version));
      } catch {
        // Cache invalidation is cleanup; policy-version keys preserve authorization truth.
      }
    },
    async requireAllowed(subject: AuthorizationSubjectContext, request: PermissionRequest) {
      const decision = (await decide(subject, request, "check")).decision;
      if (!decision.allowed) throw new AuthorizationDeniedError(decision.decisionId);
      return decision;
    },
    async resolveDataScope(
      subject: AuthorizationSubjectContext,
      request: Omit<PermissionRequest, "resourceContext">,
    ): Promise<Readonly<DataScopeResolution>> {
      const result = await decide(subject, request, "resolve_data_scope");
      return result.scope === undefined
        ? Object.freeze({ decision: result.decision })
        : Object.freeze({ decision: result.decision, scope: result.scope });
    },
  };
  return Object.freeze(service);
};
