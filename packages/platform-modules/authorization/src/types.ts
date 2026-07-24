export interface ScopeConstraint {
  readonly dimension: string;
  readonly values: readonly string[];
}

export type DataScopeTerm =
  | { readonly kind: "all" }
  | { readonly constraints: readonly ScopeConstraint[]; readonly kind: "match" };

export interface DataScope {
  readonly terms: readonly DataScopeTerm[];
  readonly version: 1;
}

export interface PermissionDeclaration {
  readonly action: string;
  readonly code: string;
  readonly resource: string;
  readonly scopeDimensions: readonly string[];
}

export interface RolePermissionBinding {
  readonly permissionCode: string;
  readonly scope: DataScope;
}

export interface RoleDefinition {
  readonly permissions: readonly RolePermissionBinding[];
  readonly roleId: string;
}

export type GrantSubject =
  | { readonly assignmentId: string; readonly kind: "assignment" }
  | { readonly kind: "person"; readonly personId: string };

export interface EffectiveRoleGrant {
  readonly grantId: string;
  readonly roleId: string;
  readonly subject: GrantSubject;
  readonly validFrom: string;
  readonly validTo?: string;
}

export interface AuthorizationPolicySnapshot {
  readonly grants: readonly EffectiveRoleGrant[];
  readonly permissions: readonly PermissionDeclaration[];
  readonly roles: readonly RoleDefinition[];
  readonly version: string;
}

export interface AuthorizationSubjectContext {
  readonly activeAssignmentIds: readonly string[];
  readonly personId: string;
  readonly selectedAssignmentId?: string;
}

export interface PermissionRequest {
  readonly action: string;
  readonly resource: string;
  readonly resourceContext?: Readonly<Record<string, string>>;
}

export type AuthorizationDecisionReason =
  | "allowed"
  | "unknown_permission"
  | "no_applicable_grant"
  | "invalid_context"
  | "resource_context_required"
  | "scope_mismatch"
  | "policy_unavailable"
  | "policy_invalid";

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly decisionId: string;
  readonly evaluatedAt: string;
  readonly policyVersion: string;
  readonly reason: AuthorizationDecisionReason;
}

export interface DataScopeResolution {
  readonly decision: Readonly<AuthorizationDecision>;
  readonly scope?: Readonly<DataScope>;
}

export interface AuthorizationPolicyStore {
  currentVersion(): Promise<string>;
  load(version: string): Promise<unknown>;
}

export interface CachedAuthorizationEvaluation {
  readonly allowed: boolean;
  readonly policyVersion: string;
  readonly reason: AuthorizationDecisionReason;
  readonly scope?: DataScope;
}

export interface AuthorizationCache {
  get(key: string): Promise<CachedAuthorizationEvaluation | undefined>;
  invalidatePolicyVersion(version: string): Promise<void>;
  set(
    key: string,
    value: CachedAuthorizationEvaluation,
    ttlSeconds: number,
    policyVersion: string,
  ): Promise<void>;
}

export interface AuthorizationDecisionRecord {
  readonly action: string;
  readonly allowed: boolean;
  readonly decisionId: string;
  readonly evaluatedAt: string;
  readonly operation: "batch_check" | "check" | "resolve_data_scope";
  readonly permissionCode: string;
  readonly policyVersion: string;
  readonly reason: AuthorizationDecisionReason;
  readonly resource: string;
}

export interface AuthorizationDecisionRecorder {
  record(record: AuthorizationDecisionRecord): Promise<void>;
}

export interface AuthorizationTelemetryEvent {
  readonly cache: "error" | "hit" | "miss" | "not_used";
  readonly durationMs: number;
  readonly operation: "batch_check" | "check" | "resolve_data_scope";
  readonly reason: AuthorizationDecisionReason;
  readonly status: "allowed" | "denied";
}

export interface AuthorizationObserver {
  record(event: AuthorizationTelemetryEvent): void;
}

export interface AuthorizationService {
  assertAllowed(decision: AuthorizationDecision): void;
  batchCheck(
    subject: AuthorizationSubjectContext,
    requests: readonly PermissionRequest[],
  ): Promise<readonly Readonly<AuthorizationDecision>[]>;
  check(
    subject: AuthorizationSubjectContext,
    request: PermissionRequest,
  ): Promise<Readonly<AuthorizationDecision>>;
  invalidatePolicyVersion(version: string): Promise<void>;
  resolveDataScope(
    subject: AuthorizationSubjectContext,
    request: Omit<PermissionRequest, "resourceContext">,
  ): Promise<Readonly<DataScopeResolution>>;
}

export interface AuthorizationServiceOptions {
  readonly cacheTtlSeconds: number;
  readonly clock?: () => Date;
  readonly decisionId?: () => string;
}
