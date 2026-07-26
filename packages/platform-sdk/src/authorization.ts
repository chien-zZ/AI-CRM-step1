import type {
  AuthorizationDecision,
  AuthorizationService,
  AuthorizationSubjectContext,
  DataScopeResolution,
  PermissionRequest,
} from "@ai-crm/platform-authorization";

export interface PlatformAuthorizationClient {
  batchCheck(
    subject: AuthorizationSubjectContext,
    requests: readonly PermissionRequest[],
  ): Promise<readonly Readonly<AuthorizationDecision>[]>;
  check(
    subject: AuthorizationSubjectContext,
    request: PermissionRequest,
  ): Promise<Readonly<AuthorizationDecision>>;
  requireAllowed(
    subject: AuthorizationSubjectContext,
    request: PermissionRequest,
  ): Promise<Readonly<AuthorizationDecision>>;
  resolveDataScope(
    subject: AuthorizationSubjectContext,
    request: Omit<PermissionRequest, "resourceContext">,
  ): Promise<Readonly<DataScopeResolution>>;
}

export const createPlatformAuthorizationClient = (
  service: Pick<AuthorizationService, "batchCheck" | "check" | "requireAllowed" | "resolveDataScope">,
): PlatformAuthorizationClient => {
  const client: PlatformAuthorizationClient = {
    batchCheck: (subject, requests) => service.batchCheck(subject, requests),
    check: (subject, request) => service.check(subject, request),
    requireAllowed: (subject, request) => service.requireAllowed(subject, request),
    resolveDataScope: (subject, request) => service.resolveDataScope(subject, request),
  };
  return Object.freeze(client);
};
