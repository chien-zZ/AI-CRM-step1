export const packageId = "@ai-crm/platform-authorization" as const;
export {
  AuthorizationDeniedError,
  AuthorizationPersistenceError,
  AuthorizationUnavailableError,
  type AuthorizationPersistenceErrorCode,
} from "./errors.js";
export { createAuthorizationService } from "./engine.js";
export {
  createPostgresAuthorizationPersistence,
  type PostgresAuthorizationPersistence,
} from "./postgres-persistence.js";
export {
  connectRedisAuthorizationCache,
  createRedisAuthorizationCache,
  type ConnectedAuthorizationCache,
  type RedisAuthorizationCacheOptions,
} from "./redis-cache.js";
export type {
  AuthorizationCache,
  AuthorizationDecision,
  AuthorizationDecisionReason,
  AuthorizationDecisionRecord,
  AuthorizationDecisionRecorder,
  AuthorizationObserver,
  AuthorizationPersistenceResult,
  AuthorizationPersistenceRuntime,
  AuthorizationPolicyPublication,
  AuthorizationPolicyPublisher,
  AuthorizationPolicySnapshot,
  AuthorizationPolicyStore,
  AuthorizationService,
  AuthorizationServiceOptions,
  AuthorizationSubjectContext,
  AuthorizationTelemetryEvent,
  CachedAuthorizationEvaluation,
  DataScope,
  DataScopeResolution,
  DataScopeTerm,
  EffectiveRoleGrant,
  GrantSubject,
  PermissionDeclaration,
  PermissionRequest,
  PublishAuthorizationPolicyCommand,
  RoleDefinition,
  RolePermissionBinding,
  ScopeConstraint,
} from "./types.js";
