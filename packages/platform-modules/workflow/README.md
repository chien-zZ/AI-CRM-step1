# Workflow

Provides a stable application-facing facade over Flowable definitions, versions, instances, and human-task actions. Flowable APIs and tables are not exposed to domain modules.

Flowable owns BPMN execution and approval tasks, while domain modules own business state. Workflow completion requests domain actions through reviewed commands or transport-neutral events and never updates domain tables directly. BPMN assets are versioned in the repository.

Unified task projection, reminders/SLA, notifications, forms, and background jobs remain separate concerns. See [ADR-0009](../../../docs/08-架构决策/ADR-0009-Flowable审批引擎与职责分离.md) and the [module description](../../../docs/03-模块说明/工作流模块.md).
