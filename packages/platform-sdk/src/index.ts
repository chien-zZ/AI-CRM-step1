export const packageId = "@ai-crm/platform-sdk" as const;
export {
  createPlatformAuthorizationClient,
  type PlatformAuthorizationClient,
} from "./authorization.js";
export type {
  AuthorizationDecision,
  AuthorizationDecisionReason,
  AuthorizationSubjectContext,
  DataScope,
  DataScopeResolution,
  DataScopeTerm,
  PermissionRequest,
  ScopeConstraint,
} from "@ai-crm/platform-authorization";
