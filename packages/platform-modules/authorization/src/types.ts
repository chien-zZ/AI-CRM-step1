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
  | { readonly kind: "workforce_person"; readonly workforcePersonId: string };

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
  readonly selectedAssignmentId?: string;
  readonly workforcePersonId: string;
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

export interface AuthorizationPersistenceResult<Row> {
  readonly rowCount: number;
  readonly rows: readonly Row[];
}

/** A vendor-neutral, transaction-aware SQL execution boundary supplied by application composition. */
export interface AuthorizationPersistenceRuntime {
  execute<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<AuthorizationPersistenceResult<Row>>;
  withTransaction<T>(work: () => Promise<T>): Promise<T>;
}

export interface PublishAuthorizationPolicyCommand {
  readonly contractVersion: string;
  /**
   * Optimistic publication precondition. `null` means that no policy may already
   * be current; a version requires that exact current version. Omitting the
   * field preserves the legacy unconditional publication behavior.
   */
  readonly expectedPreviousVersion?: string | null;
  readonly publicationId: string;
  readonly publishedAt: string;
  readonly snapshot: AuthorizationPolicySnapshot;
}

export interface AuthorizationPolicyPublication {
  readonly contentDigest: string;
  readonly previousVersion?: string;
  readonly publicationId: string;
  readonly publishedAt: string;
  readonly replayed: boolean;
  readonly version: string;
}

export interface AuthorizationPolicyPublisher {
  publish(command: PublishAuthorizationPolicyCommand): Promise<AuthorizationPolicyPublication>;
}

export interface AuthorizationPolicyPublicationActor {
  readonly actorId: string;
  readonly actorType: "authenticated_subject";
  readonly subject: AuthorizationSubjectContext;
}

export interface ProtectedPublishAuthorizationPolicyCommand extends PublishAuthorizationPolicyCommand {
  readonly actor: AuthorizationPolicyPublicationActor;
  readonly auditOperationIds: {
    readonly authorizationDenied: string;
    readonly authorizationFailed: string;
    readonly publicationFailed: string;
  };
  readonly operationId: string;
  readonly reason: { readonly code: string };
  readonly traceId: string;
}

export interface AuthorizationPolicyPublicationAuthorizer {
  requireAllowed(
    subject: AuthorizationSubjectContext,
    request: PermissionRequest,
    correlation: {
      readonly managementOperationId: string;
      readonly traceId: string;
    },
  ): Promise<Readonly<AuthorizationDecision>>;
}

export interface AuthorizationPolicyPublicationAuditRecord {
  readonly action: "authorization.policy.publish";
  readonly actor: {
    readonly actorId: string;
    readonly actorType: "authenticated_subject";
    readonly assignmentId?: string;
    readonly workforcePersonId: string;
  };
  readonly auditOperationId: string;
  readonly authorizationDecisionId?: string;
  readonly managementOperationId: string;
  readonly policyVersion: string;
  readonly publicationId: string;
  readonly reason: { readonly code: string };
  readonly result: "denied" | "failed" | "succeeded";
  readonly stage: "authorization" | "publication";
  readonly traceId: string;
}

/**
 * Application composition adapts this required port to management audit.
 * `auditOperationId` maps to Audit `trace.operationId`; the adapter must preserve Audit fingerprint semantics,
 * where a retry's new authorization decision reference does not change the existing management fact.
 */
export interface AuthorizationPolicyPublicationAuditor {
  record(record: AuthorizationPolicyPublicationAuditRecord): Promise<void>;
}

export interface ProtectedAuthorizationPolicyPublisher {
  publish(command: ProtectedPublishAuthorizationPolicyCommand): Promise<AuthorizationPolicyPublication>;
}

export interface ProtectedAuthorizationPolicyPublisherOptions {
  readonly audit: AuthorizationPolicyPublicationAuditor;
  readonly authorizer: AuthorizationPolicyPublicationAuthorizer;
  readonly permission: PermissionRequest;
  readonly publisher: AuthorizationPolicyPublisher;
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
  readonly selectedAssignmentId?: string;
  readonly traceId: string;
  readonly workforcePersonId?: string;
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
  batchCheck(
    subject: AuthorizationSubjectContext,
    requests: readonly PermissionRequest[],
  ): Promise<readonly Readonly<AuthorizationDecision>[]>;
  check(
    subject: AuthorizationSubjectContext,
    request: PermissionRequest,
  ): Promise<Readonly<AuthorizationDecision>>;
  invalidatePolicyVersion(version: string): Promise<void>;
  requireAllowed(
    subject: AuthorizationSubjectContext,
    request: PermissionRequest,
  ): Promise<Readonly<AuthorizationDecision>>;
  resolveDataScope(
    subject: AuthorizationSubjectContext,
    request: Omit<PermissionRequest, "resourceContext">,
  ): Promise<Readonly<DataScopeResolution>>;
}

export interface AuthorizationServiceOptions {
  readonly cacheTtlSeconds: number;
  readonly clock?: () => Date;
  readonly decisionId?: () => string;
  readonly traceId: () => string;
}
