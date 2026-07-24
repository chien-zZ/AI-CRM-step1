export const packageId = "@ai-crm/platform-authorization" as const;
export { AuthorizationDeniedError, AuthorizationUnavailableError } from "./errors.js";
export { createAuthorizationService } from "./engine.js";
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
  RoleDefinition,
  RolePermissionBinding,
  ScopeConstraint,
} from "./types.js";
