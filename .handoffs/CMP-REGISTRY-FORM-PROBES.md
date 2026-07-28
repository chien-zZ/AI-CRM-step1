# CMP Registry/Form PostgreSQL Capability Probes

- Status: MERGED_AND_COMPOSED
- Date: 2026-07-28
- Owner: `codex/cmp-registry-form-probes`
- Branch: `codex/cmp-registry-form-probes`
- Allowed paths: `packages/platform-modules/app-registry/**`, `packages/platform-modules/form-schema/**`, and this handoff
- Forbidden paths: `apps/**`, migrations, contracts, generated artifacts, deployment/Compose files, and the root lockfile

## Objective

Add module-owned, public, read-only PostgreSQL capability probes for the Application Registry and Form Schema production query boundaries. Each probe must fail closed unless the current PostgreSQL session can observe the exact static relations, columns, schema usage, and `SELECT` privileges required by that module's production query service.

## Known Facts

- A generic database health check or migration compatibility result does not prove that a runtime role can execute a module's production queries.
- Application Registry production reads use `app_registry.applications`, `app_registry.routes`, and `app_registry.navigation` plus their mapped query columns.
- Form Schema production reads use an exact-version join across `form_schema.releases` and `form_schema.release_status` plus their mapped query columns.
- Both modules already expose vendor-neutral PostgreSQL persistence runtimes through their public package entry points.
- Those persistence runtimes expose `execute` and `withTransaction`; they do not accept `AbortSignal` or a per-call timeout.
- Application composition, production role grants, readiness scheduling, cached status, and lifecycle cancellation are outside these packages.

## Allowed Assumptions

- Each probe may issue one PostgreSQL catalog `SELECT` through its supplied module persistence runtime.
- PostgreSQL catalog metadata plus `has_schema_privilege` and `has_column_privilege` are appropriate read-only evidence for the existing production query implementation.
- A public status containing only `available` or `unavailable` is sufficient; callers own bounded scheduling, timeouts, cancellation, and readiness aggregation.
- Missing relations, missing columns, missing privileges, malformed results, database failures, or interrupted caller-owned execution safely map to `unavailable`.
- PostgreSQL integration tests may create temporary synthetic roles and change session role inside their disposable test database to prove privilege behavior without changing production grants.

## Forbidden Assumptions

- Do not infer module capability from `SELECT 1`, migration metadata, adapter construction, logs, traces, or another module's probe.
- Do not read or manufacture application registrations, routes, navigation entries, form definitions, releases, submitted values, receipts, or Outbox events.
- Do not write, lock, open a transaction, retry, or run migrations from a probe.
- Do not claim that a successful catalog observation proves a future query will complete, remain authorized, or meet a latency objective.
- Do not expose SQL, relation names, role names, topology, credentials, raw database errors, or detailed failure reasons in the public result.
- Do not invent runtime roles, production grants, forms, applications, CRM entities, permissions, timeouts, or readiness policy.

## Non-Goals

- No `apps/api`, Worker, HTTP, BFF, authorization-policy, readiness timer, health endpoint, or deployment wiring.
- No migration, grant, role-provisioning, schema, contract, generated artifact, Compose, or root lockfile change.
- No management/write capability proof for Registry or Form Schema.
- No generic database capability abstraction and no cross-module deep import.
- No G3 or production-ready claim.

## Acceptance Boundary

- Registry exports an independent public probe and PostgreSQL factory that validate only its production query relations, required columns, schema usage, and column-level `SELECT` capability.
- Form Schema exports the equivalent independent public probe for its exact-release production query.
- Exactly one strictly shaped positive row produces `available`; negative, missing, extra, wrongly typed, empty, duplicate, inconsistent, or rejected results produce `unavailable`.
- Unit tests prove one read-only `SELECT`, no values, no transaction, and all malformed/failure cases.
- PostgreSQL integration tests prove success with the migrated schema and failure under a synthetic session role lacking required `SELECT` capability.
- READMEs state the capability's limits and the application Integration Owner's lifecycle responsibilities.

## Review Checklist

- Authorization: probes grant no access and make no business authorization decision.
- Idempotency: repeated checks are catalog reads with no semantic operation or receipt.
- Transactions: probes never call `withTransaction`.
- Migrations: no migration is added or modified.
- Observability: public output is bounded and contains no error or infrastructure detail.
- Backward compatibility: existing stores, services, query facades, and public exports remain additive and unchanged.
- Secrets/privacy: no credentials, SQL values, business rows, provider payloads, or personal data are accepted or returned.
- Lifecycle: timeout, abort, scheduling, non-overlap, generation invalidation, and shutdown remain caller-owned because the public persistence runtime has no cancellation parameter.

## Delivered Result

- Added public `ApplicationRegistryCapabilityProbe` / `ApplicationRegistryCapabilityStatus` and `createPostgresApplicationRegistryCapabilityProbe` through `@ai-crm/platform-app-registry`.
- Added public `FormSchemaCapabilityProbe` / `FormSchemaCapabilityStatus` and `createPostgresFormSchemaCapabilityProbe` through `@ai-crm/platform-form-schema`.
- Each implementation performs exactly one read-only PostgreSQL catalog `SELECT`, supplies no values, opens no transaction, performs no retry, and returns only `available` or `unavailable`.
- Registry checks schema usage and the exact 4/6/6 columns used for filtering, ordering, mapping, and returning production query data from `applications`, `routes`, and `navigation`, including column-level `SELECT` capability.
- Form Schema checks schema usage and the exact 7/3 columns used for filtering, joining, mapping, and returning exact releases from `releases` and `release_status`, including column-level `SELECT` capability.
- Exact result-shape validation fails closed for missing relations, missing columns, missing privileges, false/null/wrongly typed/missing/extra fields, empty or duplicate rows, inconsistent metadata, and rejected/interrupted database execution.
- PostgreSQL integration tests use disposable synthetic roles to prove the probes return `available` with the required grants and `unavailable` after one production-query relation loses `SELECT`.
- Updated package READMEs with capability limits and caller-owned lifecycle responsibilities.
- No application, migration, contract, generated artifact, deployment/Compose file, production grant, role, root lockfile, or business fact changed.

## Verification Evidence

- `pnpm install --frozen-lockfile`: passed without changing `pnpm-lock.yaml`.
- `pnpm --filter @ai-crm/database build`: passed for clean-worktree dependency resolution.
- Application Registry default tests: 31 passed; 5 PostgreSQL-gated tests skipped. Capability probe statement/function/line coverage: 100%.
- Form Schema default tests: 27 passed; 3 PostgreSQL-gated tests skipped. Capability probe statement/function/line coverage: 100%.
- `pnpm --filter @ai-crm/platform-app-registry test:integration`: 5 passed against disposable PostgreSQL 17.5.
- `pnpm --filter @ai-crm/platform-form-schema test:integration`: 3 passed against disposable PostgreSQL 17.5.
- Both packages passed lint, typecheck, build, and `contracts:check`.
- Full `pnpm check`: Repository tests 40/40, Compose and contract checks passed, Turbo 140/140 successful.
- `git diff --check`: passed.

## Integration Owner Wiring

- Import both factories only from their package roots; pass the same module persistence runtime already supplied to each production query service.
- Compose each probe behind the existing application-owned bounded/non-overlapping dependency-probe lifecycle, cached readiness state, generation invalidation, and shutdown behavior used for Audit.
- Replace the fixed-false Registry/Form query readiness entries only with the corresponding probe's current cached status. Do not derive either status from generic database health or another module's probe.
- Keep future query execution independently fail closed; `available` is not an authorization decision or a guarantee that a later query will succeed.
- Migration `0000000013` now defines the reviewed runtime grants, and API composition gates both module statuses on the exact runtime-role probe. These results still do not pass G3 while File, Task consumer, and first-policy publication blockers remain.

## Independent Review Follow-up

- Finding P2: the probes checked column-level `SELECT`, but Registry Store reads still used `SELECT *` and the Form exact-release read still used `r.*`. A future additive column could therefore expand the real query's privilege dependency without changing the probe and make `available` disagree with production execution.
- Fix: all Registry reads used by the query facade now project the exact application, route, and navigation columns explicitly. The Form exact-release join now projects the exact release and status columns explicitly.
- Regression evidence: PostgreSQL integration roles receive only the probe-declared column grants. Each disposable schema also receives an additional column that is deliberately not granted. Both probes and the real Registry/Form query services succeed without that unrelated column, then both fail closed after one required column grant is revoked.
- Review scope remains unchanged: no application composition, migration, production grant, contract, lockfile, or business data model was modified.
