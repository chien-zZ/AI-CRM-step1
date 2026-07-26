# Event Contracts

Transport-neutral CloudEvents and JSON Schemas. Event names, owners, versions, ordering, idempotency, privacy classification, and compatibility rules must be explicit.

Schemas in this directory must not contain RabbitMQ exchange, queue, routing, retry, dead-letter, Redis, or Worker implementation details. RabbitMQ bindings belong in `contracts/asyncapi/`; private execution requests belong in `contracts/jobs/`. See [ADR-0010](../../docs/08-架构决策/ADR-0010-RabbitMQ与Redis异步执行及Outbox-Inbox.md).

Workflow lifecycle events describe platform meaning and stable references, not raw Flowable payloads. Business state-change events remain owned by their domain modules. See [ADR-0009](../../docs/08-架构决策/ADR-0009-Flowable审批引擎与职责分离.md).

The v1 Workflow process/task lifecycle data schemas contain only stable identifiers, versions, status and bounded timestamps. Task lifecycle data carries a positive monotonic `sourceRevision` allocated by the Workflow command ledger within a task scope so projections can reject stale updates. Events are wrapped by the shared Event v1 envelope before Outbox publication; they never contain Flowable REST payloads or domain submission data.

`organization-change.v1.schema.json` carries business-neutral, effective-dated organization changes. It contains stable entity and optional Workforce Person references for session revocation, authorization invalidation, and projections; it contains no identity-provider claims, directory payloads, display attributes, or RabbitMQ topology.

`event-envelope.v1.schema.json` defines the bounded CloudEvents-style transport-neutral envelope. It carries stable message, correlation, causation, and W3C trace references without transport routing or retry policy.
