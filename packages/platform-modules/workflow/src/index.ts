export { WORKFLOW_ERROR_CODES, WorkflowError, type WorkflowErrorCode } from "./errors.js";
export { createFlowableRestEngine } from "./flowable-rest.js";
export { createWorkflowFacade } from "./service.js";
export type {
  CancelProcessCommand, ClaimTaskCommand, CompleteTaskCommand, DeployDefinitionCommand,
  FlowableRestConfig, ProcessDefinition, ProcessInstance, ProcessInstanceStatus,
  ReleaseTaskCommand, StartProcessCommand, WorkflowActor, WorkflowAudit,
  WorkflowAuditRecord, WorkflowAuthorization, WorkflowAuthorizationDecision,
  WorkflowCommandLedger, WorkflowCommandResult, WorkflowCommandStatus, WorkflowEngine, WorkflowFacade, WorkflowFacadeOptions,
  WorkflowHealth, WorkflowLifecycleEvent, WorkflowLifecycleSink, WorkflowObserver,
  WorkflowOperation, WorkflowTask, WorkflowTaskStatus, WorkflowTelemetryEvent,
  WorkflowVariable, WorkflowVariableKind, WorkflowVariablePolicy,
} from "./types.js";

export const packageId = "@ai-crm/platform-workflow" as const;
