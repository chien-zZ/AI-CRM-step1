import type { WorkflowErrorCode } from "./errors.js";

export type WorkflowOperation = "definition_deploy" | "process_cancel" | "process_start" | "task_claim" | "task_complete" | "task_release";
export interface WorkflowActor { readonly principalId: string }
export interface WorkflowAuthorizationDecision { readonly allowed: boolean; readonly decisionId: string }
export interface WorkflowAuthorization { authorize(input: { readonly actor: WorkflowActor; readonly operation: WorkflowOperation; readonly referenceId: string; readonly targetAssigneeReference?: string }): Promise<Readonly<WorkflowAuthorizationDecision>> }
export interface WorkflowAuditRecord { readonly actor: WorkflowActor; readonly authorizationDecisionId: string; readonly idempotencyKey: string; readonly operation: WorkflowOperation; readonly phase: "attempted" | "failed" | "succeeded"; readonly referenceId: string; readonly errorCode?: string }
export interface WorkflowAudit { record(record: WorkflowAuditRecord): Promise<void> }

export type WorkflowVariableKind = "boolean" | "number" | "reference" | "string";
export type WorkflowVariable = boolean | number | string;
export interface WorkflowVariablePolicy { readonly definitions: Readonly<Record<string, Readonly<Record<string, WorkflowVariableKind>>>> }

export interface DeployDefinitionCommand { readonly actor: WorkflowActor; readonly assetName: string; readonly assetVersion: string; readonly bpmnXml: string; readonly definitionKey: string; readonly idempotencyKey: string }
export interface StartProcessCommand { readonly actor: WorkflowActor; readonly definitionKey: string; readonly definitionVersion: number; readonly idempotencyKey: string; readonly variables: Readonly<Record<string, WorkflowVariable>> }
export interface CancelProcessCommand { readonly actor: WorkflowActor; readonly idempotencyKey: string; readonly processInstanceId: string; readonly reason: string }
export interface ClaimTaskCommand { readonly actor: WorkflowActor; readonly assigneeReference: string; readonly idempotencyKey: string; readonly taskId: string }
export interface ReleaseTaskCommand { readonly actor: WorkflowActor; readonly idempotencyKey: string; readonly taskId: string }
export interface CompleteTaskCommand { readonly actor: WorkflowActor; readonly definitionKey: string; readonly idempotencyKey: string; readonly taskId: string; readonly variables?: Readonly<Record<string, WorkflowVariable>> }

export interface ProcessDefinition { readonly definitionId: string; readonly deploymentId: string; readonly key: string; readonly resourceName: string; readonly version: number }
export type ProcessInstanceStatus = "active" | "cancelled" | "completed";
export interface ProcessInstance { readonly definitionId: string; readonly definitionKey: string; readonly definitionVersion: number; readonly processInstanceId: string; readonly status: ProcessInstanceStatus; readonly startedAt?: string; readonly endedAt?: string }
export type WorkflowTaskStatus = "active" | "cancelled" | "completed" | "expired";
export interface WorkflowTask { readonly definitionId: string; readonly processInstanceId: string; readonly status: WorkflowTaskStatus; readonly taskDefinitionKey: string; readonly taskId: string; readonly assigneeReference?: string; readonly createdAt?: string; readonly endedAt?: string }
export interface WorkflowHealth { readonly status: "available" | "unavailable" }

export interface WorkflowEngine {
  cancelProcess(processInstanceId: string, reason: string, traceparent?: string): Promise<void>;
  claimTask(taskId: string, assigneeReference: string, traceparent?: string): Promise<Readonly<WorkflowTask>>;
  completeTask(taskId: string, variables: Readonly<Record<string, WorkflowVariable>>, traceparent?: string): Promise<Readonly<WorkflowTask>>;
  deployDefinition(input: { readonly assetName: string; readonly bpmnXml: string; readonly definitionKey: string; readonly traceparent?: string }): Promise<Readonly<ProcessDefinition>>;
  getDefinition(definitionKey: string, version: number, traceparent?: string): Promise<Readonly<ProcessDefinition>>;
  getInstance(processInstanceId: string, traceparent?: string): Promise<Readonly<ProcessInstance>>;
  getTask(taskId: string, traceparent?: string): Promise<Readonly<WorkflowTask>>;
  health(): Promise<Readonly<WorkflowHealth>>;
  listTasks(processInstanceId: string, traceparent?: string): Promise<readonly Readonly<WorkflowTask>[]>;
  releaseTask(taskId: string, traceparent?: string): Promise<Readonly<WorkflowTask>>;
  startProcess(input: { readonly businessKey: string; readonly definition: ProcessDefinition; readonly traceparent?: string; readonly variables: Readonly<Record<string, WorkflowVariable>> }): Promise<Readonly<ProcessInstance>>;
}

export type WorkflowCommandStatus = "absent" | "completed" | "reconciliation_required" | "running";
export interface WorkflowCommandResult<T> { readonly value: T; readonly sourceRevision?: number }
export interface WorkflowCommandLedger {
  execute<T>(input: { readonly fingerprint: string; readonly idempotencyKey: string; readonly operation: WorkflowOperation; readonly revisionScope?: string }, action: () => Promise<T>): Promise<Readonly<WorkflowCommandResult<T>>>;
  getStatus(input: { readonly idempotencyKey: string; readonly operation: WorkflowOperation }): Promise<WorkflowCommandStatus>;
}
export type WorkflowLifecycleEvent =
  | { readonly eventType: "workflow.process-lifecycle.v1"; readonly data: ProcessInstance & { readonly eventKey: string; readonly occurrence: "cancelled" | "started" } }
  | { readonly eventType: "workflow.task-lifecycle.v1"; readonly data: WorkflowTask & { readonly eventKey: string; readonly occurrence: "claimed" | "completed" | "released"; readonly sourceRevision: number } };
export interface WorkflowLifecycleSink { publish(event: WorkflowLifecycleEvent): Promise<void> }
export interface WorkflowTelemetryEvent { readonly durationMs: number; readonly operation: WorkflowOperation | "definition_query" | "health" | "instance_query" | "task_query"; readonly status: "completed" | "failed" | "idempotent"; readonly errorCode?: WorkflowErrorCode }
export interface WorkflowObserver { record(event: WorkflowTelemetryEvent): void }
export interface WorkflowFacadeOptions { readonly traceparent?: () => string | undefined; readonly variablePolicy: WorkflowVariablePolicy }
export interface WorkflowFacade {
  cancelProcess(command: CancelProcessCommand): Promise<Readonly<ProcessInstance>>;
  claimTask(command: ClaimTaskCommand): Promise<Readonly<WorkflowTask>>;
  completeTask(command: CompleteTaskCommand): Promise<Readonly<WorkflowTask>>;
  deployDefinition(command: DeployDefinitionCommand): Promise<Readonly<ProcessDefinition>>;
  getDefinition(definitionKey: string, version: number): Promise<Readonly<ProcessDefinition>>;
  getInstance(processInstanceId: string): Promise<Readonly<ProcessInstance>>;
  health(): Promise<Readonly<WorkflowHealth>>;
  listTasks(processInstanceId: string): Promise<readonly Readonly<WorkflowTask>[]>;
  releaseTask(command: ReleaseTaskCommand): Promise<Readonly<WorkflowTask>>;
  startProcess(command: StartProcessCommand): Promise<Readonly<ProcessInstance>>;
}
export interface FlowableRestConfig { readonly baseUrl: string; readonly password: string; readonly timeoutMs: number; readonly username: string; readonly fetch?: typeof fetch }
