import type { HealthDependency } from "@ai-crm/observability";
import type { AuthenticatedPrincipal } from "@ai-crm/platform-auth-context";
import type { ApplicationRegistryService } from "@ai-crm/platform-app-registry";
import type { AuditService } from "@ai-crm/platform-audit";
import type {
  AuthorizationDecision,
  AuthorizationService,
  PermissionRequest,
} from "@ai-crm/platform-authorization";
import type { FileCenterService } from "@ai-crm/platform-file-center";
import type { FormSchemaService } from "@ai-crm/platform-form-schema";
import type { NotificationCenter } from "@ai-crm/platform-notifications";
import type { OrganizationServiceApi, WorkforceContext } from "@ai-crm/platform-organization";
import type { TaskCenter } from "@ai-crm/platform-task-center";

import type { PcAuthenticationHttpAdapter } from "./auth/http-adapter.js";
import type { PcBffSessionService } from "./auth/session-service.js";
import type { ApiComposition } from "./index.js";

export interface DatabaseMigrationCompatibility {
  readonly assertCompatible: (signal: AbortSignal) => void | Promise<void>;
}

export interface ProtectedOperationInput {
  readonly at: string;
  readonly credential: string;
  readonly permission: PermissionRequest;
  readonly selectedAssignmentId?: string;
}

export interface AuthorizedOperationContext {
  readonly decision: Readonly<AuthorizationDecision>;
  readonly principal: Readonly<AuthenticatedPrincipal>;
  readonly workforce: Readonly<WorkforceContext>;
}

export interface ApiQueryBindings {
  readonly applicationRegistry: Pick<ApplicationRegistryService, "loadRegistry" | "resolveDeepLink">;
  readonly fileCenter: Pick<FileCenterService, "authorizeDownload">;
  readonly forms: Pick<FormSchemaService, "getRelease" | "validateSubmission">;
  readonly notifications: Pick<NotificationCenter, "get" | "list" | "unreadCount">;
  readonly tasks: Pick<TaskCenter, "get" | "list">;
}

export interface ApiPlatformBindings {
  readonly audit: AuditService;
  readonly authentication: PcAuthenticationHttpAdapter;
  readonly authenticationCallbackUrl: (requestPathAndQuery: string) => string;
  readonly authorization: AuthorizationService;
  readonly databaseCompatibility: DatabaseMigrationCompatibility;
  readonly organization: OrganizationServiceApi;
  readonly queries: ApiQueryBindings;
  readonly readiness: () => readonly HealthDependency[];
  readonly sessions: Pick<PcBffSessionService, "resolvePrincipal">;
}

export interface ApiPlatformComposition {
  readonly bindings: ApiPlatformBindings;
  readonly lifecycle: Pick<ApiComposition, "authentication" | "authenticationCallbackUrl" | "dependencies" | "onStart">;
  readonly authorize: (input: ProtectedOperationInput) => Promise<Readonly<AuthorizedOperationContext>>;
}

function requireBinding(value: unknown, name: string): void {
  if (value === undefined || value === null) throw new Error(`api_binding_missing_${name}`);
}

function requireFunction(value: unknown, name: string): void {
  if (typeof value !== "function") throw new Error(`api_binding_missing_${name}`);
}

function requireMethod(value: object, method: string, name: string): void {
  requireFunction(Reflect.get(value, method), name);
}

function assertStartupActive(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("api_start_cancelled");
}

/**
 * Explicit application wiring. It intentionally creates no HTTP business
 * routes: the reviewed contracts do not yet define a generic authorization or
 * capability endpoint. Controllers can consume these named bindings directly.
 */
export function createApiPlatformComposition(bindings: ApiPlatformBindings): Readonly<ApiPlatformComposition> {
  requireBinding(bindings.audit, "audit");
  requireBinding(bindings.authentication, "authentication");
  requireBinding(bindings.authorization, "authorization");
  requireBinding(bindings.databaseCompatibility, "database_compatibility");
  requireBinding(bindings.organization, "organization");
  requireBinding(bindings.queries, "queries");
  requireBinding(bindings.queries.applicationRegistry, "application_registry_queries");
  requireBinding(bindings.queries.fileCenter, "file_queries");
  requireBinding(bindings.queries.forms, "form_queries");
  requireBinding(bindings.queries.notifications, "notification_queries");
  requireBinding(bindings.queries.tasks, "task_queries");
  requireBinding(bindings.sessions, "sessions");
  requireMethod(bindings.audit, "readSensitive", "audit_read");
  requireMethod(bindings.audit, "record", "audit_record");
  requireMethod(bindings.authentication, "beginLogin", "authentication_begin_login");
  requireMethod(bindings.authentication, "completeLogin", "authentication_complete_login");
  requireMethod(bindings.authentication, "currentSession", "authentication_current_session");
  requireMethod(bindings.authentication, "logout", "authentication_logout");
  requireMethod(bindings.authentication, "refresh", "authentication_refresh");
  requireFunction(bindings.authenticationCallbackUrl, "authentication_callback_url");
  requireMethod(bindings.authorization, "requireAllowed", "authorization_require_allowed");
  requireFunction(bindings.databaseCompatibility.assertCompatible, "database_compatibility_check");
  requireMethod(bindings.organization, "resolveWorkforceContext", "organization_resolve_workforce");
  requireMethod(bindings.queries.applicationRegistry, "loadRegistry", "application_registry_load");
  requireMethod(bindings.queries.applicationRegistry, "resolveDeepLink", "application_registry_resolve_deep_link");
  requireFunction(bindings.queries.fileCenter.authorizeDownload, "file_authorize_download");
  requireFunction(bindings.queries.forms.getRelease, "form_get_release");
  requireFunction(bindings.queries.forms.validateSubmission, "form_validate_submission");
  requireFunction(bindings.queries.notifications.get, "notification_get");
  requireFunction(bindings.queries.notifications.list, "notification_list");
  requireFunction(bindings.queries.notifications.unreadCount, "notification_unread_count");
  requireFunction(bindings.queries.tasks.get, "task_get");
  requireFunction(bindings.queries.tasks.list, "task_list");
  requireFunction(bindings.readiness, "readiness");
  requireFunction(bindings.sessions.resolvePrincipal, "session_resolve_principal");

  const authorize = async (input: ProtectedOperationInput): Promise<Readonly<AuthorizedOperationContext>> => {
    const principal = await bindings.sessions.resolvePrincipal(input.credential);
    const workforce = await bindings.organization.resolveWorkforceContext(
      principal.authenticationSubject,
      input.at,
      input.selectedAssignmentId,
    );
    const decision = await bindings.authorization.requireAllowed({
      activeAssignmentIds: workforce.assignments.map((assignment) => assignment.assignmentId),
      ...(input.selectedAssignmentId === undefined ? {} : { selectedAssignmentId: input.selectedAssignmentId }),
      workforcePersonId: workforce.workforcePersonId,
    }, input.permission);
    return Object.freeze({ decision, principal, workforce });
  };

  return Object.freeze({
    authorize,
    bindings,
    lifecycle: Object.freeze({
      authentication: bindings.authentication,
      authenticationCallbackUrl: bindings.authenticationCallbackUrl,
      dependencies: bindings.readiness,
      onStart: async (signal: AbortSignal) => {
        assertStartupActive(signal);
        await bindings.databaseCompatibility.assertCompatible(signal);
        assertStartupActive(signal);
      },
    }),
  });
}
