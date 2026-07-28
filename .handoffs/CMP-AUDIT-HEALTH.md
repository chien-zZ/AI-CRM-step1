# CMP-AUDIT-HEALTH: Audit-Owned Non-Writing Capability Probe

- Status: COMPLETE; awaiting Integration Owner merge and application composition
- Date: 2026-07-28
- Owner: CMP-01 audit capability subtask
- Allowed paths: `packages/platform-modules/audit/**` and this handoff
- Forbidden paths: `apps/**`, `deploy/**`, existing migrations, contracts, generated artifacts, and the root lockfile

## Objective

Add a public, audit-owned PostgreSQL capability probe that lets an application determine whether the current connection can observe the static prerequisites used by the Audit repository. The probe is read-only, fails closed, and does not create an Audit fact.

## Known Facts

- Audit records are explicit append-only security evidence, not health telemetry or inferred application logs.
- `@ai-crm/platform-audit` currently exposes its Service and PostgreSQL Store but no independent capability or health port.
- A generic database `SELECT 1` and migration compatibility do not establish the Audit repository's schema, relation, session-mode, privilege, or PostgreSQL function prerequisites.
- The PostgreSQL Store uses the module-owned `audit.records` and `audit.operation_receipts` relations, a transaction, an advisory transaction lock, and `SELECT ... FOR UPDATE` on an operation receipt before appending.
- API composition, production role grants, and database-role permission governance are outside this task.

## Allowed Assumptions

- The probe may use the supplied vendor-neutral Audit persistence runtime to execute one bounded PostgreSQL `SELECT` against catalog and session capability functions.
- PostgreSQL catalog privilege functions, relation resolution, `current_user`, and `transaction_read_only` are appropriate read-only observations for the existing PostgreSQL Store implementation.
- The stable public result may expose only `available` or `unavailable`; callers own timeout, scheduling, caching, lifecycle, and Readiness aggregation.
- A missing relation, missing privilege, read-only session, malformed result, or query failure is safely represented as `unavailable`.

## Forbidden Assumptions

- Do not claim that a successful non-writing probe proves a future append or commit will succeed.
- Do not append, update, delete, lock an Audit row, open a transaction, or manufacture a synthetic Audit fact during the probe.
- Do not infer capability from generic database health, adapter presence, logs, traces, or migration metadata alone.
- Do not expose SQL text, role names, relation details, topology, credentials, or raw database errors in the public result.
- Do not add or change PostgreSQL grants, roles, migrations, application composition, deployment files, external contracts, or generated artifacts.

## Non-Goals

- No API or Worker wiring, HTTP endpoint, timer, timeout, cache, liveness policy, or production Ready claim.
- No Audit sensitive-read authorization, retention, export, legal hold, cryptographic sealing, or CRM behavior.
- No database permission matrix, runtime-role provisioning, migration change, or proof of durable write availability.
- No change to Audit append, replay, transaction, immutability, or error semantics.

## Public Contract

- Export an independent `AuditCapabilityProbe` interface with `check(): Promise<AuditCapabilityStatus>`.
- `AuditCapabilityStatus` contains only `status: "available" | "unavailable"`.
- Export a PostgreSQL factory through the package root. Do not add health behavior to `AuditService` or expose Store internals.

## PostgreSQL Behavior

- Execute exactly one read-only `SELECT` per check and do not call `withTransaction`.
- Observe the current transaction mode, required Audit schema/relations, Store-aligned relation privileges, and required advisory-lock/hash function execution privileges.
- Return `available` only for exactly one row with the exact expected boolean fields all equal to `true`.
- Return `unavailable` for false, null, missing, extra, wrongly typed, empty, duplicate, or rejected results.

## Failure And Recovery

- The probe catches persistence/query failures and returns `unavailable` without leaking the cause.
- The probe performs no retry. The application composition owner decides bounded retry and recovery scheduling.
- Checks are idempotent reads and create no Audit, receipt, transaction, or migration fact.

## Acceptance

1. The new contract and PostgreSQL factory are importable only through the package public entry point.
2. A complete, strictly shaped successful observation returns `available`.
3. Every incomplete, malformed, negative, or rejected observation returns `unavailable`.
4. Tests prove the implementation performs one `SELECT`, supplies no values, and never enters `withTransaction`.
5. Package lint, typecheck, tests, and build pass.

## Review Checklist

- Authorization: the probe grants no access and makes no authorization decision.
- Idempotency: repeated checks are read-only and create no semantic operation.
- Transactions: the probe does not start or join an explicit transaction.
- Migrations: no migration is added or modified.
- Observability and Audit: stable status only; no logs, raw errors, or false Audit facts.
- Backward compatibility: `AuditService` and Store behavior remain unchanged; the public API is additive.
- Secrets and privacy: no credentials, row data, SQL parameters, or sensitive details leave the module.
- Lifecycle: timeout, cancellation, scheduling, and shutdown remain caller-owned and must fail closed when composed.

## Delivered Result

- Added the independent public `AuditCapabilityProbe` and `AuditCapabilityStatus` contract plus `createPostgresAuditCapabilityProbe`.
- The PostgreSQL implementation performs one `SELECT` and checks current transaction read-only mode, Audit schema/relations, Store-aligned relation privileges, and the hashing/advisory-lock function privileges used by the existing Store.
- Exact result-shape validation fails closed for false, null, missing, extra, wrongly typed, empty, duplicate, inconsistent, or rejected results.
- The probe starts no transaction, writes no row, creates no Audit or receipt fact, performs no retry, and exposes no failure detail.
- The package README explicitly states that observable prerequisites do not prove a future append or commit will succeed.
- No application, deployment, contract, generated artifact, migration, grant, role, or lockfile was changed.

## Verification Evidence

- `pnpm --filter @ai-crm/platform-audit lint`: passed with zero warnings.
- `pnpm --filter @ai-crm/platform-audit typecheck`: passed.
- `pnpm --filter @ai-crm/platform-audit test`: 18 passed; 3 existing PostgreSQL integration cases skipped because `TEST_AUDIT_DATABASE_URL_FILE` was not supplied. The new capability probe has 100% statement, function, and line coverage.
- `pnpm --filter @ai-crm/platform-audit build`: passed.
- `git diff --check`: passed before final commit.

## Remaining Integration Work

- CMP-01 may compose the public probe with caller-owned timeout, non-overlapping scheduling, cached Readiness state, generation invalidation, and shutdown behavior.
- A successful probe must be described only as observable prerequisite availability. Real Audit operations continue to fail closed independently.
- Production runtime-role grants and their versioned governance remain unresolved and are not bypassed by this probe.
