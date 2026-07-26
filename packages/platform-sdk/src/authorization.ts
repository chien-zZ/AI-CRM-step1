import type {
  AuthorizationDecision,
  AuthorizationService,
  AuthorizationSubjectContext,
  DataScopeResolution,
  PermissionRequest,
} from "@ai-crm/platform-authorization";

export interface PlatformAuthorizationClient {
  assertAllowed(decision: AuthorizationDecision): void;
  batchCheck(
    subject: AuthorizationSubjectContext,
    requests: readonly PermissionRequest[],
  ): Promise<readonly Readonly<AuthorizationDecision>[]>;
  check(
    subject: AuthorizationSubjectContext,
    request: PermissionRequest,
  ): Promise<Readonly<AuthorizationDecision>>;
  resolveDataScope(
    subject: AuthorizationSubjectContext,
    request: Omit<PermissionRequest, "resourceContext">,
  ): Promise<Readonly<DataScopeResolution>>;
}

export const createPlatformAuthorizationClient = (
  service: Pick<AuthorizationService, "assertAllowed" | "batchCheck" | "check" | "resolveDataScope">,
): PlatformAuthorizationClient => {
  const client: PlatformAuthorizationClient = {
    assertAllowed: (decision) => { service.assertAllowed(decision); },
    batchCheck: (subject, requests) => service.batchCheck(subject, requests),
    check: (subject, request) => service.check(subject, request),
    resolveDataScope: (subject, request) => service.resolveDataScope(subject, request),
  };
  return Object.freeze(client);
};
