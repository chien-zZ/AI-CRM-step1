# CMP Registry/Form PostgreSQL Query Boundary

- Status: IMPLEMENTED; awaiting independent review and CMP-01 composition
- Owner: `codex/cmp-registry-form`
- Allowed paths: `packages/platform-modules/app-registry`, `packages/platform-modules/form-schema`, and this handoff

## Known Facts

- CMP-01 already owns the protected internal HTTP Controllers, BFF session resolution, workforce resolution, static HTTP permission checks, PostgreSQL runtime, and production Composition Root.
- Application Registry and Form Schema already own reviewed PostgreSQL Stores and migrations. This task needs no schema or contract change.
- Registry snapshot/deep-link reads must recheck each registered dynamic permission reference. Form reads and validation must authorize the exact definition and immutable release before PostgreSQL lookup.
- A production authorization decision requires the current workforce person, all active Assignment IDs, an optional selected Assignment, and the request Trace. Constructor-only authorization ports do not carry that complete request state.
- Query paths do not create mutation audit facts, operation receipts, Outbox events, or submitted form data.

## Allowed Assumptions

- A query-only public Facade may accept a transport-neutral, explicit request context produced by the trusted BFF session -> Organization -> Authorization chain.
- The request context may structurally mirror the accepted Authorization subject boundary without importing the Authorization package or exposing database/runtime objects.
- Registered permission codes retain the reviewed `<resource>:<action>` form and may be split at the final colon for the application-composed Authorization adapter.
- Existing module PostgreSQL Stores remain the fact source; the new factories compose them without running migrations or schema synchronization.

## Forbidden Assumptions

- Do not invent roles, grants, policy seed data, CRM applications/forms, Assignment transport headers, identities, display copy, form fields, or submitted domain data.
- Do not trust Actor, workforce person, selected Assignment, active Assignment set, or Trace when they contradict each other or violate accepted bounds.
- Do not use process-global mutable request state, query another module's tables, deep-import another package, or expose SQL/query builders/transactions through the public API.
- Do not treat an outer HTTP permission check as authorization for a registered Registry target or exact Form release.

## Non-goals

- No `apps/api` or `apps/worker` wiring, Controller changes, HTTP contract changes, root Lockfile changes, generated contracts, migrations, seed data, health/readiness implementation, or production deployment evidence.
- No Registry management writes, Form draft/publication writes, audit adapter, cache, Redis, RabbitMQ, UI renderer, or provider integration.
- No claim that CMP-01 reaches G3 until its Owner composes these factories, provides readiness evidence, and passes the repository merge gates.

## Composition Root Follow-up

- CMP-01 must adapt its resolved `AuthorizedOperationContext` into the exported query context: stable Actor ID, workforce person, all active Assignment IDs, optional selected Assignment, and the same inbound Trace ID.
- The application-composed query authorizers call the existing Authorization service with the supplied subject. Registry uses the exported dynamic permission reference; Form uses the exported fixed release read/validate permission reference.
- The production PostgreSQL runtime is passed only through each package's public query factory. Readiness remains false until factory construction and a bounded, non-mutating module-owned query/readiness policy are explicitly composed and reviewed.

## Verification Evidence

- Frozen workspace install completed without changing `pnpm-lock.yaml`; `@ai-crm/database` was built first because the clean worktree had no upstream `dist` artifacts.
- Application Registry: build, typecheck, lint, contracts check passed; 16 default tests passed and 4 environment-gated PostgreSQL tests skipped. The 3 new query tests cover dynamic permission mapping, explicit subject propagation, contradictory context, and authorization dependency failure. The isolated PostgreSQL 17.5 run passed all 4 Store/migration tests.
- Form Schema: build, typecheck, lint, contracts check passed; 12 default tests passed and 2 environment-gated PostgreSQL tests skipped. The 3 new query tests cover exact-release authorization, exact-release server validation, denial before SQL, and contradictory context. The isolated PostgreSQL 17.5 run passed both Store/migration tests.
- No migration, contract, generated artifact, root Lockfile, `apps/api`, or `apps/worker` file changed.

## Owner Review

- Authorization: target checks receive the complete request subject and Trace; Registry checks every dynamic application/route reference; Form checks the exact definition/version before lookup. Denial and dependency failure fail closed.
- Idempotency/transactions: all added operations are read-only. They create no receipt, transaction, Outbox row, audit fact, or submitted-data write.
- Migrations/backward compatibility: no schema or contract changes. Existing management Facades and Store exports remain intact; query-only types and factories are additive public exports.
- Observability/secrets: the boundary propagates only validated Trace and opaque stable IDs. It logs nothing and accepts no credentials, cookies, tokens, provider payloads, SQL, or Secret values.
