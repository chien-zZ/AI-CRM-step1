# Workflow

Provides a stable application-facing facade over Flowable definitions, versions, instances, and human-task actions. Flowable APIs and tables are not exposed to domain modules.

Flowable owns BPMN execution and approval tasks, while domain modules own business state. Workflow completion requests domain actions through reviewed commands or transport-neutral events and never updates domain tables directly. BPMN assets are versioned in the repository.

Unified task projection, reminders/SLA, notifications, forms, and background jobs remain separate concerns. See [ADR-0009](../../../docs/08-架构决策/ADR-0009-Flowable审批引擎与职责分离.md) and the [module description](../../../docs/03-模块说明/工作流模块.md).

## Public Boundary

`createWorkflowFacade` exposes versioned definition deployment/query, idempotent process start/cancel, human-task claim/release/complete, instance/task query and health. Callers provide stable Authorization, Audit, Command Ledger and Lifecycle Sink ports. Provider REST DTOs and credentials stay inside `createFlowableRestEngine`.

Mutations validate bounded inputs and definition-specific variable allowlists before authorization. Allowed actions record an attempted audit fact before Flowable access and a succeeded/failed result afterward; denied actions are audited and never reach Flowable. Identical commands from the same actor share one Ledger result, while conflicting payload or actor reuse fails closed.

The production Ledger must durably and atomically claim `(operation, idempotencyKey, actor-scoped fingerprint)` before invoking the supplied action. For task commands it also atomically allocates a monotonically increasing revision within the task scope and retains that revision with the result. It must retain completed results and `reconciliation_required` failures across process restarts and replicas. `getStatus` exposes `absent`, `running`, `completed`, or `reconciliation_required`; only an explicit operator reconciliation procedure may resolve an unknown remote outcome. The memory implementation exported from `./testing` is not a production implementation. Durable composition and operator recovery belong to CMP-01 and OPS.

The Ledger protects only the Flowable state change. Lifecycle publication follows with a deterministic `eventKey`; the production Lifecycle Sink must use it as the idempotent Outbox message identity. If publication or final audit fails, retry returns the recorded Flowable result and retries the remaining step without repeating the engine mutation. Ambiguous remote write timeouts and successful writes followed by failed confirmation reads become non-retryable `WORKFLOW_RECONCILIATION_REQUIRED` results. Automatic retries return that retained result and never issue the write again; they must never report approval success.

Flowable variables are limited to explicitly registered boolean, finite number, stable reference and bounded string values. BPMN deployment accepts only one matching executable process and a first-stage human-task element allowlist; executable hooks, provider extensions, expressions, DTDs, entities and additional processes are rejected. The REST adapter requires HTTPS except for loopback development, forbids redirects, stream-limits response bytes, normalizes timestamps, bounds identifiers, propagates W3C `traceparent`, and maps provider errors to stable Workflow errors without logging bodies or credentials. Task lifecycle facts include the command Ledger's positive `sourceRevision` so downstream projections can reject stale updates without depending on a Flowable database row or a provider DTO field that its REST API does not expose.

Run `pnpm --filter @ai-crm/platform-workflow test:integration` for an isolated PostgreSQL + Flowable 7.2.0 verification. It uses temporary Secret files, deploys only the synthetic BPMN asset, exercises human-task and history paths, removes the deployment, then deletes containers, network, volume and temporary Secrets.
