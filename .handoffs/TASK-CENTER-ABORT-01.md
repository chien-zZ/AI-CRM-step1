# TASK-CENTER-ABORT-01

## Scope

Task Center projection persistence now accepts an optional caller `AbortSignal` and propagates it to the owning PostgreSQL transaction and every SQL statement executed by `apply`. This work does not wire the Worker consumer or change RabbitMQ topology.

## Facts And Boundaries

- Known fact: ADR-0027 fixes the Task projection handler timeout at 10 seconds.
- Allowed assumption: adding `apply(event, signal?)` is backward compatible for existing callers.
- Forbidden assumption: racing the returned Promise proves that PostgreSQL stopped. The persistence runtime must implement query cancellation and must not commit after abort.
- Forbidden assumption: an aborted operation may continue on a transaction connection after that connection has been released or destroyed.
- Non-goals: Worker wiring, RabbitMQ retry topology, production consumer activation, schema changes, CRM domain behavior, and provider integration.

## Implementation

- `TaskCenter.apply` and `TaskCenterStore.apply` accept an optional `AbortSignal`.
- `createTaskCenter` forwards the same signal to the store.
- The PostgreSQL store passes the same signal to transaction acquisition and every statement in projection apply.
- The PostgreSQL store checks cancellation before and after each awaited statement and uses a private signal-aware projection read inside the transaction.
- `createPostgresTaskCenterStore` fails closed unless the runtime advertises `abortSignalSupport: true`.
- The in-memory store rejects a pre-aborted operation before changing state.

## Verification

- Unit tests cover service-to-store signal propagation, pre-abort without transaction acquisition, signal identity on every SQL call, unsupported runtime rejection, and cancellation ordering with no late SQL or commit.
- PostgreSQL integration coverage holds the projection advisory lock in another transaction, aborts the blocked apply, checks bounded failure, and verifies that neither projection nor event receipt committed. The isolated run passed 4/4 tests and cleaned its Compose container, network, and volume.
- The 4/4 PostgreSQL integration suite was rerun after the database runtime adopted server-confirmed `pg_cancel_backend` cancellation and remained green.
- Package commands passed: `pnpm --filter @ai-crm/platform-task-center lint`, `typecheck`, and `test` (40 passed, 4 integration tests skipped by the default command).

## Eight-Dimension Review

- Authorization: unchanged. Projection ingestion remains an internal transport-neutral operation; user task operations retain current authorization checks.
- Idempotency: unchanged. Event fingerprint receipts and source-version protection remain in the same transaction; abort rolls the whole transaction back.
- Transactions: strengthened. Abort reaches transaction acquisition and active SQL; no successful commit is allowed after cancellation.
- Migrations: not applicable. No schema or migration changed.
- Observability: existing bounded operation/outcome/duration telemetry remains; no signal reason, SQL, payload, or personal data is emitted.
- Backward compatibility: existing `apply(event)` callers remain valid; the signal parameter is additive. PostgreSQL composition now fails closed for runtimes that do not advertise cancellation support.
- Secrets: unchanged. No credential or configuration value was added.
- Failure modes: pre-abort fails before acquisition; mid-query abort prevents later SQL and commit; unsupported runtimes fail at store construction; errors remain mapped to retryable `TASK_STORAGE_UNAVAILABLE` at the service boundary.

## Open Evidence

- Worker composition now passes the Eventing handler signal through the compatible Task Center apply boundary, but production bootstrap remains deliberately disabled.
- The real PostgreSQL cancellation integration test requires Docker and is not part of the default unit test command; both the Task Center lock test and database `pg_sleep` cancellation test passed in this combined wave.
