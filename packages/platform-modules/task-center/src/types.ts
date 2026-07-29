export type TaskProjectionStatus = "cancelled" | "completed" | "open";
export type TaskOperation = "task_complete" | "task_detail" | "task_list" | "task_reconcile";

export interface TaskActor { readonly activeAssignmentIds?: readonly string[]; readonly principalId: string }
export interface TaskDeepLink { readonly appId: string; readonly routeId: string }
export interface TaskProjectionKey { readonly sourceType: string; readonly sourceTaskId: string }
export interface TaskProjection extends TaskProjectionKey {
  readonly projectionId: string;
  readonly sourceVersion: number;
  readonly status: TaskProjectionStatus;
  readonly deepLink: TaskDeepLink;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly assigneeReference?: string;
  readonly candidateScopeReference?: string;
  readonly dueAt?: string;
}
export interface TaskLifecycleEvent extends TaskProjectionKey {
  readonly eventId: string;
  readonly sourceVersion: number;
  readonly occurredAt: string;
  readonly status: TaskProjectionStatus;
  readonly deepLink: TaskDeepLink;
  readonly assigneeReference?: string;
  readonly candidateScopeReference?: string;
  readonly dueAt?: string;
}
export interface TaskAuthorizationDecision { readonly allowed: boolean; readonly decisionId: string }
export interface TaskAuthorization {
  authorize(input: { readonly actor: TaskActor; readonly operation: TaskOperation; readonly task?: TaskProjectionKey }): Promise<TaskAuthorizationDecision>;
}
export interface TaskAudit {
  record(input: { readonly actor: TaskActor; readonly operation: TaskOperation; readonly phase: "attempted" | "failed" | "succeeded"; readonly decisionId: string; readonly referenceId: string; readonly errorCode?: string }): Promise<void>;
}
export interface TaskObserver {
  record(input: { readonly operation: TaskOperation | "projection_apply"; readonly outcome: "completed" | "denied" | "duplicate" | "failed" | "stale"; readonly durationMs: number }): void;
}
export interface TaskSourceCommandRouter {
  complete(input: TaskProjectionKey & { readonly actor: TaskActor; readonly idempotencyKey: string }): Promise<{ readonly sourceCommandId: string; readonly status: "accepted" }>;
}
export interface TaskSourceReader { get(key: TaskProjectionKey): Promise<TaskLifecycleEvent> }
export interface CompleteTaskCommand extends TaskProjectionKey { readonly actor: TaskActor; readonly idempotencyKey: string }
export interface TaskQuery { readonly actor: TaskActor; readonly status?: TaskProjectionStatus; readonly limit?: number; readonly cursor?: string }
export interface TaskPage { readonly items: readonly TaskProjection[]; readonly nextCursor?: string }
export interface TaskCommandResult { readonly sourceCommandId: string; readonly status: "accepted" }
export type TaskCommandClaim =
  | { readonly status: "claimed"; readonly leaseToken: string }
  | { readonly status: "running" }
  | { readonly status: "accepted"; readonly result: TaskCommandResult };
export interface ProjectionApplyResult { readonly status: "applied" | "duplicate" | "stale"; readonly projection: TaskProjection }
export interface ReconciliationResult { readonly status: "applied" | "current" | "stale"; readonly projection: TaskProjection }

export interface TaskCenterStore {
  apply(event: TaskLifecycleEvent, signal?: AbortSignal): Promise<ProjectionApplyResult>;
  reconcile(event: TaskLifecycleEvent): Promise<ProjectionApplyResult>;
  get(key: TaskProjectionKey): Promise<TaskProjection | undefined>;
  list(input: { readonly status?: TaskProjectionStatus; readonly limit: number; readonly cursor?: string }): Promise<TaskPage>;
  claimCommand(input: { readonly idempotencyKey: string; readonly fingerprint: string; readonly leaseToken: string; readonly now: Date; readonly leaseExpiresAt: Date }): Promise<TaskCommandClaim>;
  acceptCommand(input: { readonly idempotencyKey: string; readonly leaseToken: string; readonly result: TaskCommandResult }): Promise<boolean>;
  releaseCommand(input: { readonly idempotencyKey: string; readonly leaseToken: string }): Promise<void>;
}
export interface TaskCenter {
  apply(event: TaskLifecycleEvent, signal?: AbortSignal): Promise<ProjectionApplyResult>;
  complete(command: CompleteTaskCommand): Promise<TaskCommandResult>;
  get(actor: TaskActor, key: TaskProjectionKey): Promise<TaskProjection>;
  list(query: TaskQuery): Promise<TaskPage>;
  reconcile(actor: TaskActor, key: TaskProjectionKey): Promise<ReconciliationResult>;
}
