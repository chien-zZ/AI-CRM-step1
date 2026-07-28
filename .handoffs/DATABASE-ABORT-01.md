# DATABASE-ABORT-01 PostgreSQL AbortSignal Boundary

- Status: IMPLEMENTED; integration review pending combined merge
- Date: 2026-07-28
- Owner: root integration line

## Known Facts

- Task projection Handler timeout must stop its owned PostgreSQL operation before the transaction connection can be released or reused.
- `pg@8.16.3` does not expose a typed AbortSignal query option through the current public query configuration.
- The real `pg_sleep` test rejected both `pg-pool` removal and direct `Client.end()` as sufficient proof: both ended the local wait while the backend session and transaction lock remained alive until the statement completed.
- PostgreSQL accepts cancellation of a session owned by the same database identity through `pg_cancel_backend(pid)`.

## Allowed Assumptions

- A signal-bearing operation may use a dedicated pooled connection and destroy it on abort.
- A short-lived cancellation connection may authenticate as the same database identity solely to cancel the runtime-owned backend PID; PostgreSQL authorizes a role to cancel its own sessions.
- Existing callers without a signal retain the existing pool query and transaction behavior.

## Forbidden Assumptions

- A `Promise.race` timeout does not prove SQL cancellation.
- An aborted or destroyed connection must not be returned to the pool, committed, or reused.
- Local Promise rejection, pool removal, and direct client shutdown are not evidence that the PostgreSQL backend statement stopped.
- The runtime must not expose `pg` Client, Query, transaction handles, SQL parameters, or connection details through its public API or telemetry.

## Non-goals

- No automatic migration, cross-module repository, CRM schema, production timeout value, or database high-availability claim.
- No requirement that unrelated existing runtime fakes implement cancellation; capability consumers must require `abortSignalSupport === true`.

## Implementation

- Added optional `AbortSignal` inputs to `DatabaseRuntime.execute` and `withTransaction` and an additive `abortSignalSupport` capability marker.
- `PostgresRuntime` advertises the marker as literal `true`.
- Pre-aborted operations fail before pool acquisition.
- Signal-bearing operations acquire a dedicated connection. Abort requests server-side cancellation through a short-lived same-identity client, waits for acceptance, then ends and removes the original client from the pool; normal completion releases it once.
- Transaction abort destroys the connection, prevents commit, and relies on PostgreSQL disconnect rollback. The operation awaits the query/work rejection before returning.
- A signal passed only to a transaction-internal query or nested transaction also destroys the owning transaction connection, so alternate valid API usage cannot continue or commit after cancellation.
- Rollback failure destroys the connection while preserving the original work error.

## Verification

- Database unit suite: 32 passed, 6 gated integration tests skipped in the ordinary package gate.
- Unit coverage proves pre-abort does not acquire, an active query destroys exactly once, inner-query and nested-transaction signals destroy the outer transaction, and caught cancellation still cannot commit.
- `pnpm db:test:integration`: 37/37 passed. The real `pg_sleep(30)` test completes cancellation in under two seconds, proves the backend PID disappears, verifies the insert rolls back, and confirms the pool remains usable.
- Database lint and typecheck pass.

## Eight-Area Review

- Authorization: no authorization behavior or database privilege expansion.
- Idempotency: abort performs one destructive release; repeated signal delivery cannot double-release.
- Transactions: abort prevents commit and server disconnect rolls back; normal and nested transactions remain compatible.
- Migrations: none.
- Observability: no query, parameter, connection, or error detail is logged.
- Backward compatibility: signal and marker are additive; no-signal behavior is unchanged.
- Secrets: connection strings remain configuration inputs and are not emitted.
- Failure modes: pre-abort, acquisition-race abort, active-query abort, caught inner abort, cancellation rejection, rollback failure, and post-abort pool recovery are explicit.
