# CMP-API-QUERY-AUDIT API Query And Audit Composition

- Status: REVIEWED; ready for final commit
- Owner: CMP-01 Integration Owner
- Date: 2026-07-28
- Allowed paths: `apps/api/**`, Registry/Form query Facades, CMP handoffs, and the execution board

## Objective

Compose the audit-owned non-writing capability probe and the PostgreSQL Registry/Form query Facades through public package entry points while preserving request-scoped workforce authorization and fail-closed production readiness.

## Known Facts

- The PC BFF already resolves an opaque session to a verified principal, unique Workforce Person, active Employment, active Assignment set, and an authorization decision.
- Registry dynamic application/route permission references and Form exact definition/release permissions require module-level rechecks using the complete current request subject.
- Generic database health cannot establish Audit relation/permission prerequisites, and a non-writing probe cannot guarantee that a future append will commit.
- The production `ai_crm_runtime` role currently has database `CONNECT` only. A reviewed runtime-role permission matrix and forward migrations are still absent.
- File Center Provider details and Task projection production runtime values remain unresolved and must stay disabled.

## Allowed Assumptions

- API composition may pass stable actor IDs, Workforce Person ID, all active Assignment IDs, an optional selected Assignment, and the same inbound Trace ID to module-owned query Facades.
- Registry/Form may call the existing Authorization public service again for dynamic or exact resource checks.
- Audit capability checks may be cached with the same bounded, non-overlapping, generation-aware lifecycle as database readiness.

## Forbidden Assumptions

- No role, Grant, policy, application, form, Assignment transport header, CRM fact, Provider, retry value, or production Secret is invented.
- Registry/Form readiness is not inferred from constructor success, migration compatibility, or a generic database probe.
- Audit capability availability is not described as proof that the next append will succeed.
- File Local Adapter, synthetic Provider, or disabled RabbitMQ consumer is not reported as production ready.

## Non-goals

- No production role grants or policy seed, File/COS/ClamAV Adapter, Worker consumer activation, CRM module, external contract, migration, or root Lockfile change.

## Implementation

- Registry/Form expose additive query-only PostgreSQL Facades with explicit request authorization subjects.
- API HTTP adapters carry the full active Assignment set and optional selected Assignment into those Facades.
- Module Facades reject accessors, widened objects, contradictory workforce/Assignment context, malformed Trace/IDs, denial, and dependency failure before SQL.
- API production composition constructs both Facades through package roots and maps module permissions back into the existing Authorization service under the same Trace.
- API composes the audit-owned capability probe with a bounded, non-overlapping readiness cache. Timeout, abort, database loss, close, malformed results, and old generations remain unhealthy.
- Registry/Form required readiness remains false until module-owned runtime capability checks and reviewed role grants exist.

## Review Dimensions

- Authorization: outer static HTTP permission and inner dynamic/exact module permission are both required.
- Idempotency: all new Registry/Form operations and Audit probes are reads and create no receipt, Audit fact, Outbox event, or submitted data.
- Transactions: no new transaction is opened; existing Store reads and Authorization decision recording retain their reviewed boundaries.
- Migrations: none. Runtime grants require separate reviewed forward migrations after the permission matrix is accepted.
- Observability: only validated Trace and stable opaque IDs cross the boundary; no body, token, SQL, personal display data, or raw error is logged.
- Backward compatibility: package exports are additive; protected HTTP operation shapes are unchanged.
- Secrets: no new Secret or configuration value.
- Failure modes: malformed context, denial, database/policy/audit failure, timeout, abort, and shutdown all fail closed.

## Remaining G3 Gates

- Approve the bootstrap authority, Owner/permission, review/emergency route, and management Audit Adapter needed to publish the first reviewed non-empty production authorization policy; no seed is added here.
- Resolve and implement COS/ClamAV Provider details and file work sourcing.
- Accept Task projection retry, timeout, prefetch, concurrency, capacity, and alert values before activating production consumers.

## Independent Review And Fixes

- Round 1 found no P0/P1 and three P2 findings.
- P2 dependency sequencing: aborting a stuck Audit check could start a policy SQL afterward. Audit and policy checks now launch together only after a current-generation/active-signal check; close/abort cannot construct a later dependency query.
- P2 scheduler coupling: a dependency query that ignored timeout could permanently freeze database health sampling. Database probes now retain their own non-overlapping loop, while Audit/policy share a separate non-overlapping in-flight guard and remain unhealthy after timeout until their underlying query settles.
- P2 nested accessors: top-level snapshots still allowed getters inside Actor, Assignment arrays, and Registry Link. Both module Facades and both HTTP adapters now inspect nested property descriptors and dense array entries without invoking accessors.
- Regression tests reproduce each reported path and assert no post-close policy query, continued database health sampling, zero getter executions, zero unauthorized SQL, and stable failure surfaces.
- The same independent Reviewer rechecked the fixes and closed all three P2 findings with no new actionable finding across authorization, idempotency, transactions, migrations, observability, backward compatibility, Secrets, and failure behavior.

## Verification

- Focused tests after fixes: API 168 passed/5 environment-gated skipped; Application Registry 18 passed/4 environment-gated skipped; Form Schema 14 passed/2 environment-gated skipped. The independent recheck additionally passed its API 66/66, Application Registry 5/5, and Form Schema 5/5 regression selection.
- Focused lint and typecheck passed for API, Application Registry, and Form Schema; `git diff --check` passed.
- Final full repository `pnpm check` after the fixes passed with Repository 40/40, Compose static checks, generated contract validation, and Turbo 140/140.
