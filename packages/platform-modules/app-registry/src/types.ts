export type RegistryAudience = "external" | "internal";
export type DeepLinkSource = "notification" | "task";

export interface RegistryActor {
  readonly actorId: string;
  readonly actorType: "authenticated_subject" | "system";
  readonly assignmentId?: string;
  readonly workforcePersonId?: string;
}

export interface RegisteredApplication {
  readonly applicationId: string;
  readonly audience: RegistryAudience;
  readonly enabled: boolean;
  readonly permissionCode: string;
}

export interface RegisteredRoute {
  readonly applicationId: string;
  readonly deepLinkSources: readonly DeepLinkSource[];
  readonly enabled: boolean;
  readonly path: string;
  readonly permissionCode: string;
  readonly routeId: string;
}

export interface RegisteredNavigation {
  readonly applicationId: string;
  readonly enabled: boolean;
  readonly navigationId: string;
  readonly order: number;
  readonly parentNavigationId?: string;
  readonly routeId: string;
}

export interface RegistrySnapshot {
  readonly applications: readonly RegisteredApplication[];
  readonly navigation: readonly RegisteredNavigation[];
  readonly routes: readonly RegisteredRoute[];
  readonly version: 1;
}

export interface RegisteredDeepLink {
  readonly applicationId: string;
  readonly resourceReference: string;
  readonly routeId: string;
  readonly source: DeepLinkSource;
  readonly version: 1;
}

export interface ResolvedDeepLink {
  readonly applicationId: string;
  readonly path: string;
  readonly resourceReference: string;
  readonly routeId: string;
}

export interface RegistryCommandMetadata {
  readonly actor: RegistryActor;
  readonly operationId: string;
  readonly reason: string;
  readonly traceId: string;
}

export type RegistryMutationCommand = RegistryCommandMetadata & (
  | { readonly application: RegisteredApplication; readonly kind: "register_application" }
  | { readonly kind: "register_route"; readonly route: RegisteredRoute }
  | { readonly kind: "register_navigation"; readonly navigation: RegisteredNavigation }
  | { readonly applicationId: string; readonly enabled: boolean; readonly kind: "set_application_enabled" }
  | { readonly enabled: boolean; readonly kind: "set_route_enabled"; readonly routeId: string }
);

export interface RegistryAuthorizationRequest {
  readonly action: "app_registry:manage" | "app_registry:view" | "app_registry:resolve";
  readonly actor: RegistryActor;
  readonly permissionCode?: string;
  readonly resourceId: string;
  readonly resourceType: "application" | "route";
}

export interface RegistryAuthorizer {
  authorize(request: RegistryAuthorizationRequest): Promise<{ readonly allowed: boolean; readonly decisionId: string }>;
}

export interface RegistryAudit {
  record(input: {
    readonly action: string;
    readonly actor: RegistryActor;
    readonly authorizationDecisionId?: string;
    readonly operationId: string;
    readonly reason: string;
    readonly resourceId: string;
    readonly resourceType: "application" | "route";
    readonly result: "attempted" | "denied" | "failed" | "succeeded";
    readonly traceId: string;
  }): Promise<void>;
}

export interface ApplicationRegistryService {
  loadRegistry(input: { readonly actor: RegistryActor; readonly audience: RegistryAudience }): Promise<RegistrySnapshot>;
  mutate(command: RegistryMutationCommand): Promise<{ readonly replayed: boolean }>;
  resolveDeepLink(input: { readonly actor: RegistryActor; readonly audience: RegistryAudience; readonly link: RegisteredDeepLink }): Promise<ResolvedDeepLink>;
}

export interface RegistryAuthorizationSubject {
  readonly activeAssignmentIds: readonly string[];
  readonly selectedAssignmentId?: string;
  readonly workforcePersonId: string;
}

export interface RegistryQueryContext {
  readonly actor: RegistryActor;
  readonly subject: RegistryAuthorizationSubject;
  readonly traceId: string;
}

export interface RegistryPermissionReference {
  readonly action: string;
  readonly code: string;
  readonly resource: string;
}

export interface RegistryQueryAuthorizationRequest {
  readonly actor: RegistryActor;
  readonly permission: RegistryPermissionReference;
  readonly resourceId: string;
  readonly resourceType: "application" | "route";
  readonly subject: RegistryAuthorizationSubject;
  readonly traceId: string;
}

export interface RegistryQueryAuthorizer {
  authorize(request: RegistryQueryAuthorizationRequest): Promise<{ readonly allowed: boolean; readonly decisionId: string }>;
}

export interface ApplicationRegistryQueryService {
  loadRegistry(input: { readonly audience: RegistryAudience; readonly context: RegistryQueryContext }): Promise<RegistrySnapshot>;
  resolveDeepLink(input: { readonly audience: RegistryAudience; readonly context: RegistryQueryContext; readonly link: RegisteredDeepLink }): Promise<ResolvedDeepLink>;
}
