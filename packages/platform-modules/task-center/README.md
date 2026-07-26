# Task Center

Maintains a unified projection of work assigned by workflows and future business systems. Source systems remain authoritative for the underlying business state.

Commands are routed back to the source system; this module never completes a Flowable task or changes domain state on its own. Projection updates are idempotent, version-aware, replayable, and repairable through reconciliation.

## Public boundary

- `apply` consumes a validated, transport-neutral lifecycle event. The durable store records the event receipt and projection in one transaction; a repeated event is stable and an older source version cannot replace a newer projection.
- `list` and `get` fail closed and re-run server-side authorization. List results are filtered per projection rather than trusting client visibility.
- `complete` durably reserves an idempotency key and routes the command through `TaskSourceCommandRouter`. An accepted command does not close the projection; only a later authoritative lifecycle event can do so.
- `reconcile` is an authorized operation that reads one authoritative source snapshot and applies the same version rules as event replay.

Deep links contain only reviewed stable `appId` and `routeId` identifiers. URLs and route payloads are not accepted or persisted. Source adapters must honor the provided idempotency key because a timeout after remote acceptance is retried.

## Operations

Run the additive migration through the repository migration runner. Runtime startup must not synchronize schemas. `DATABASE_MIGRATION_URL_FILE` is required by the package migration entry point and must reference a non-empty Secret file.

Telemetry contains operation, outcome, and duration only. Authorization denial, storage/audit failure, a source outage, and an in-progress command are explicit failures; none is reported as task completion. PostgreSQL integration tests run in an isolated Compose project with `pnpm --filter @ai-crm/platform-task-center test:integration`.

See [ADR-0009](../../../docs/08-架构决策/ADR-0009-Flowable审批引擎与职责分离.md) and the [module description](../../../docs/03-模块说明/统一任务中心.md).
