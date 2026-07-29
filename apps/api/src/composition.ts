import { createHash } from "node:crypto";

import { createTraceContext, extractTraceContext, type HealthDependency } from "@ai-crm/observability";
import type { AuthenticatedPrincipal } from "@ai-crm/platform-auth-context";
import type { ApplicationRegistryQueryService } from "@ai-crm/platform-app-registry";
import type { AuditService } from "@ai-crm/platform-audit";
import type {
  AuthorizationDecision,
  AuthorizationService,
  PermissionRequest,
} from "@ai-crm/platform-authorization";
import type { FileCenterService } from "@ai-crm/platform-file-center";
import type { FormSchemaQueryService } from "@ai-crm/platform-form-schema";
import type { NotificationCenter } from "@ai-crm/platform-notifications";
import type { OrganizationServiceApi, WorkforceContext } from "@ai-crm/platform-organization";
import type { TaskCenter } from "@ai-crm/platform-task-center";

import type { PcAuthenticationHttpAdapter } from "./auth/http-adapter.js";
import type { PcBffSessionService } from "./auth/session-service.js";
import type { ApiComposition } from "./index.js";
import {
  createApplicationRegistryHttpAdapter,
  type ApplicationRegistryHttpAdapter,
} from "./platform-http/application-registry-http.js";
import {
  createFileCenterHttpAdapter,
  type FileCenterHttpAdapter,
} from "./platform-http/file-center-http.js";
import {
  createFormSchemaHttpAdapter,
  type FormSchemaHttpAdapter,
} from "./platform-http/form-schema-http.js";

export interface DatabaseMigrationCompatibility {
  readonly assertCompatible: (signal: AbortSignal) => void | Promise<void>;
}

export interface ProtectedOperationInput {
  readonly at: string;
  readonly credential: string;
  readonly permission: PermissionRequest;
  readonly selectedAssignmentId?: string;
  readonly traceId?: string;
}

export interface AuthorizedOperationContext {
  readonly decision: Readonly<AuthorizationDecision>;
  readonly principal: Readonly<AuthenticatedPrincipal>;
  readonly workforce: Readonly<WorkforceContext>;
}

export interface ApiQueryBindings {
  readonly applicationRegistry: ApplicationRegistryQueryService;
  readonly fileCenter: Pick<FileCenterService, "authorizeDownload" | "completeUpload" | "createUploadSession">;
  readonly forms: FormSchemaQueryService;
  readonly notifications: Pick<NotificationCenter, "get" | "list" | "unreadCount">;
  readonly tasks: Pick<TaskCenter, "get" | "list">;
}

export interface ApiPlatformBindings {
  readonly audit: AuditService;
  readonly authentication: PcAuthenticationHttpAdapter;
  readonly authenticationCallbackUrl: (requestPathAndQuery: string) => string;
  readonly browserSecurity: { readonly allowedOrigins: readonly string[] };
  readonly authorization: AuthorizationService;
  readonly authorizationTrace: {
    readonly run: <T>(traceId: string, work: () => Promise<T>) => Promise<T>;
  };
  readonly close?: () => void | Promise<void>;
  readonly databaseCompatibility: DatabaseMigrationCompatibility;
  readonly organization: OrganizationServiceApi;
  readonly queries: ApiQueryBindings;
  readonly readiness: () => readonly HealthDependency[];
  readonly sessions: Pick<PcBffSessionService, "resolvePrincipal" | "sessionForMutation">;
}

export interface ApiPlatformHttpComposition {
  readonly applicationRegistry: ApplicationRegistryHttpAdapter;
  readonly authorize: ApiPlatformComposition["authorize"];
  readonly fileCenter: FileCenterHttpAdapter;
  readonly forms: FormSchemaHttpAdapter;
}

export interface ApiPlatformComposition {
  readonly bindings: ApiPlatformBindings;
  readonly lifecycle: Pick<ApiComposition, "authentication" | "authenticationCallbackUrl" | "dependencies" | "onStart" | "onStop" | "platformHttp">;
  readonly authorize: (input: ProtectedOperationInput) => Promise<Readonly<AuthorizedOperationContext>>;
}

function actorId(context: Readonly<AuthorizedOperationContext>): string {
  const subject = context.principal.authenticationSubject;
  return `subject:${createHash("sha256").update(`${subject.issuer}\0${subject.subject}`).digest("hex")}`;
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
  requireBinding(bindings.browserSecurity, "browser_security");
  requireBinding(bindings.authorization, "authorization");
  requireBinding(bindings.authorizationTrace, "authorization_trace");
  if (bindings.close !== undefined) requireFunction(bindings.close, "close");
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
  requireFunction(bindings.authorizationTrace.run, "authorization_trace_run");
  requireFunction(bindings.databaseCompatibility.assertCompatible, "database_compatibility_check");
  requireMethod(bindings.organization, "resolveWorkforceContext", "organization_resolve_workforce");
  requireMethod(bindings.queries.applicationRegistry, "loadRegistry", "application_registry_load");
  requireMethod(bindings.queries.applicationRegistry, "resolveDeepLink", "application_registry_resolve_deep_link");
  requireFunction(bindings.queries.fileCenter.authorizeDownload, "file_authorize_download");
  requireFunction(bindings.queries.fileCenter.completeUpload, "file_complete_upload");
  requireFunction(bindings.queries.fileCenter.createUploadSession, "file_create_upload_session");
  requireMethod(bindings.queries.forms, "getRelease", "form_get_release");
  requireMethod(bindings.queries.forms, "validateSubmission", "form_validate_submission");
  requireFunction(bindings.queries.notifications.get, "notification_get");
  requireFunction(bindings.queries.notifications.list, "notification_list");
  requireFunction(bindings.queries.notifications.unreadCount, "notification_unread_count");
  requireFunction(bindings.queries.tasks.get, "task_get");
  requireFunction(bindings.queries.tasks.list, "task_list");
  requireFunction(bindings.readiness, "readiness");
  requireFunction(bindings.sessions.resolvePrincipal, "session_resolve_principal");
  requireFunction(bindings.sessions.sessionForMutation, "session_for_mutation");

  const authorize = async (input: ProtectedOperationInput): Promise<Readonly<AuthorizedOperationContext>> => {
    const traceId = input.traceId ?? createTraceContext().traceId;
    return bindings.authorizationTrace.run(traceId, async () => {
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
    });
  };
  const applicationRegistry = createApplicationRegistryHttpAdapter(bindings.queries.applicationRegistry);
  const forms = createFormSchemaHttpAdapter({
    authorize: async (input) => {
      const traceId = extractTraceContext({ traceparent: input.traceparent }).traceId;
      const context = await authorize({ ...input, traceId });
      return Object.freeze({
        activeAssignmentIds: context.workforce.assignments.map((assignment) => assignment.assignmentId),
        actorId: actorId(context),
        traceId,
        workforcePersonId: context.workforce.workforcePersonId,
        ...(input.selectedAssignmentId === undefined ? {} : { assignmentId: input.selectedAssignmentId }),
      });
    },
    service: bindings.queries.forms,
  });
  const fileCenter = createFileCenterHttpAdapter({
    actorResolver: {
      resolve: async (input) => {
        const context = await authorize({
          at: new Date().toISOString(),
          credential: input.credential,
          permission: {
            action: input.operation,
            resource: "platform.file-center.file",
          },
          traceId: input.traceId,
          ...(input.selectedAssignmentId === undefined ? {} : { selectedAssignmentId: input.selectedAssignmentId }),
        });
        return Object.freeze({
          actorId: context.workforce.workforcePersonId,
          actorType: "authenticated_subject" as const,
          ...(input.selectedAssignmentId === undefined ? {} : { assignmentId: input.selectedAssignmentId }),
        });
      },
    },
    allowedOrigins: bindings.browserSecurity.allowedOrigins,
    service: bindings.queries.fileCenter,
    sessions: bindings.sessions,
  });
  const platformHttp: Readonly<ApiPlatformHttpComposition> = Object.freeze({
    applicationRegistry,
    authorize,
    fileCenter,
    forms,
  });

  return Object.freeze({
    authorize,
    bindings,
    lifecycle: Object.freeze({
      authentication: bindings.authentication,
      authenticationCallbackUrl: bindings.authenticationCallbackUrl,
      dependencies: bindings.readiness,
      platformHttp,
      onStart: async (signal: AbortSignal) => {
        assertStartupActive(signal);
        await bindings.databaseCompatibility.assertCompatible(signal);
        assertStartupActive(signal);
      },
      ...(bindings.close === undefined ? {} : { onStop: bindings.close }),
    }),
  });
}
