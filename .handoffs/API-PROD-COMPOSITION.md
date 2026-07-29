# API Production Composition

- Status: REVIEW_FIX_VERIFIED
- Owner: CMP-01 API production composition line
- Allowed paths: `apps/api/**` and this handoff

## Historical CMP-API-DB-READY Task Boundary

This section preserves that completed subtask's original scope. The later `CMP-API-AUTH-PERSIST Integration Result` section records the additive authorization, Organization, and audit composition.

### Known Facts

- `DatabaseRuntime` publicly exposes `healthCheck()` and already owns the bounded PostgreSQL Pool configured by the API production composition.
- Migration compatibility is a startup-only, read-only check. It does not prove that PostgreSQL remains reachable after startup.
- The synchronous health contract can only return cached dependency state; it cannot await a fresh database query.

### Allowed Assumptions

- The API composition may maintain one application-owned, non-overlapping PostgreSQL health probe loop after migration compatibility succeeds.
- Probe interval and application-side timeout are typed, bounded technical configuration values. A timeout or unavailable result marks only the cached database readiness fact unavailable.
- A later successful probe may restore cached database readiness while the same production binding generation remains active.

### Forbidden Assumptions

- A successful startup compatibility check, open Pool, or stale successful probe proves current database readiness.
- The probe may run migrations, DDL, module queries, or inspect another module's tables.
- A timed-out probe's late result may not update readiness; another interval may start only after its underlying call settles. A stopped, aborted, or superseded generation may neither update readiness nor schedule another timer.
- Health output may expose SQL, connection details, dependency errors, topology, or Secret values.

### Non-goals

- No authorization policy, authentication audit, Organization, protected Controller, RabbitMQ, Worker, Compose, migration, contract, or Lockfile change.
- No production availability, failover, SLA, RPO, or RTO claim.
- No replacement for operator monitoring or a transaction-level database failure policy.

## Known Facts

- API has reviewed PC BFF authentication routes and a principal -> workforce context -> authorization chain.
- `@ai-crm/database` publicly exposes a bounded PostgreSQL runtime and read-only migration compatibility checker.
- The API authentication boundary publicly exposes file-backed BFF configuration, Redis session storage, OIDC discovery, token verification, and HTTP/session adapters.
- ADR-0025 is accepted. The application boundary now has reviewed PostgreSQL `AuthorizationPolicyStore`, `AuthorizationDecisionRecorder`, Organization read resolution, and authentication-audit composition through public module entry points.
- Application startup must check migration compatibility and must not apply migrations or synchronize schema.

## Allowed Assumptions

- The production image or mount supplies an absolute migration root containing the reviewed repository `packages/**/migrations` layout.
- PostgreSQL, Redis, OIDC, and JWKS connection/operation limits use the bounded values supplied by typed configuration.
- The API application database uses an independent `x.y.z` schema compatibility version; the release identifier is not reused for this purpose.

## Forbidden Assumptions

- No roles, grants, policies, CRM permissions, resources, or organizational facts are seeded.
- A reachable Redis, PostgreSQL, or identity provider does not prove authorization or audit readiness.
- Technical logs do not replace authentication audit records.
- Startup does not execute `runMigrations`, `drizzle-kit push`, or any DDL.
- No database internal row, Drizzle schema, query builder, transaction handle, or deep package import becomes an application contract.

## Non-Goals

- This line does not register Task, Notification, Registry, Form, or File HTTP controllers.
- This line does not implement authorization administration, a policy store, an audit policy, a provider adapter, or any CRM domain behavior.
- This line does not change Compose, contract bundles, Worker composition, or the root Lockfile.

## Implemented Boundary

- Production configuration requires PostgreSQL URL, OIDC client, Redis password, and session keys through typed `*_FILE` Secret references; no Secret value is logged or returned by health endpoints.
- PostgreSQL runtime, Redis session connection, OIDC discovery, token verification, BFF session service, and HTTP authentication adapter are composed from public package/application entry points.
- Migration compatibility reads the complete reviewed catalog and fails startup on missing, unknown, modified, evidence-mismatched, or application-incompatible migrations.
- Initialization failure closes resources already acquired. Application stop closes Redis and PostgreSQL once; close failure remains a lifecycle failure.
- Readiness tracks migration compatibility, live Redis and PostgreSQL state, the formally composed authentication-audit dependency, and a freshly loaded complete current authorization policy. Because no Permission, Role, Grant, or current policy is seeded, an empty production database remains Not Ready by design.
- After migration compatibility succeeds, Readiness also tracks a cached, bounded `DatabaseRuntime.healthCheck()` loop. Probes do not overlap; timeout, rejection and unavailable results fail closed, later success recovers, and shutdown/abort invalidates timers and late results before resource close.

## Authorization And Audit

- Authorization remains default-deny through the existing `AuthorizationUnavailableError` boundary and uses the durable PostgreSQL policy store and decision recorder.
- Workforce resolution uses the PostgreSQL Organization public service. Organization writes fail at the application authorizer before database access; no synthetic organization or policy data is used in production.
- Authentication state-changing operations use the PostgreSQL Audit public service. Logical operation IDs are deterministically derived from the state index, session ID, or session ID plus next revision; one safe trace is captured per logical operation, and an uncertain append retries once with the same immutable command.
- No audit record, authorization decision, or successful protected operation is fabricated.

## Idempotency, Transactions, And Failure

- This composition adds no domain command. Authorization decisions use the durable recorder's idempotency semantics; authentication audit retries preserve the same deterministic operation ID and immutable command.
- Redis session Lua operations retain their reviewed atomicity and session rotation semantics.
- Migration compatibility is read-only and does not open an application transaction or acquire a migration lock.
- PostgreSQL, Redis, OIDC, JWKS, Secret, compatibility, and cleanup failures reject initialization or readiness without exposing credentials or dependency details through HTTP health output.

## Observability And Compatibility

- Existing API lifecycle logging records stable operation/error categories without Secret values, bodies, tokens, SQL parameters, or provider payloads.
- Health responses remain the existing `{status}` contract; internal dependency labels are not serialized.
- Development/test synthetic bindings retain their previous behavior. `ApiPlatformBindings.close` is optional for source compatibility; production supplies it.
- The shared Lockfile has been updated by the single Integration Owner for the accepted workspace dependency window and passes frozen installation.

## Verification

- API ordinary suite: 99 passed, 5 dependency integration tests skipped.
- Focused typecheck and lint passed. The final repository `pnpm check` passed 140/140 Turbo tasks, including build and contract checks.
- Real PostgreSQL/Redis/Keycloak integration gates remain the Integration Owner's responsibility after production Compose wiring is merged.

## Unresolved Questions And G3 Blockers

- Resolved by ADR-0025 and AUTH-PERSIST-01: authorization policy versions/publications and decision records use the reviewed module-owned PostgreSQL persistence; no real policy facts are seeded.
- Resolved for production composition by CMP-API-AUTH-PERSIST: authentication audit maps through the public PostgreSQL Audit service with deterministic logical operation IDs and safe retry. Retention remains an Audit Owner decision and is not invented here.
- What production image path supplies all migration source files, and how is its catalog integrity tied to the immutable release artifact?
- Resolved by CMP-API-DB-READY: the synchronous health dependency reads a bounded application cache maintained by the public `DatabaseRuntime`; it does not execute a fresh query per request.
- Historical note: this subpackage did not complete CMP-01 at the time. The repository-side composition was later merged in `e090dda`; the current aggregate status is `EVIDENCE_BLOCKED`, and E2E-01 remains blocked until the external G3 evidence closes.

## Independent Review And Fix

- Review found that production resource acquisition began before signal/deadline control, partial-start cleanup could wait forever and suppress close failures, and factory failures lacked a stable structured lifecycle event.
- `runApiMain` now installs SIGINT/SIGTERM cancellation and the configured startup deadline before invoking the binding factory. The factory receives the `AbortSignal`; Redis initial connection disables unbounded reconnect and is abortable, while OIDC discovery combines the external signal with its request timeout.
- Partial initialization cleanup is bounded by the configured shutdown budget. Cleanup rejection or timeout is retained with the original initialization failure as `api_production_initialization_cleanup_failed`.
- Regression tests cover acquisition-time SIGTERM, non-zero cleanup failure, startup timeout, rejected cleanup and never-settling cleanup. The focused API suite passes 85 tests with 5 dependency integration tests skipped by the ordinary gate.

## CMP-API-DB-READY Result

- Added typed `AI_CRM_API_POSTGRES_HEALTH_INTERVAL_MS` and `AI_CRM_API_POSTGRES_HEALTH_TIMEOUT_MS` configuration. Both are bounded and the timeout must be shorter than the interval.
- The first health probe runs after read-only migration compatibility succeeds. Subsequent probes use recursive scheduling so one application-owned probe generation never overlaps itself.
- Probe timeout/rejection/unavailable state removes database readiness; a later ready result restores it. Stop and Abort clear timers, abort the active wait, invalidate the generation and ignore late underlying results.
- An application timeout cannot cancel the public `DatabaseRuntime.healthCheck()` call. Scheduling therefore waits for that underlying call to settle before starting the interval, preventing accumulated Pool queries when a probe remains stuck; a never-settling call leaves Readiness unavailable without launching more probes.
- The probe uses only public `DatabaseRuntime.healthCheck()` and does not run migration, DDL, module SQL or automatic schema synchronization.
- Verification: API ordinary suite 90 passed and 5 dependency integration tests skipped; API typecheck, lint, build and contracts check passed; `git diff --check` passed.
- The reviewed authorization and authentication-audit adapters are composed. Absence of a complete published policy still deliberately keeps production Not Ready. This historical subpackage was later superseded by the merged G3 composition in `e090dda`; CMP-01 is now `EVIDENCE_BLOCKED`, and E2E-01 remains blocked by the external G3 evidence.
- Independent review found one P2 overlapping-query risk after an application timeout. The scheduler now waits for underlying settlement, and regression coverage proves advancing multiple timeout/interval windows cannot start a second query while the first is pending. Re-review closed the P2 with no new P1/P2; its P3 wording correction now distinguishes ignored late readiness from the permitted next interval after underlying settlement.

## CMP-API-AUTH-PERSIST Integration Result

- ADR-0025 was accepted by the project owner on 2026-07-28. Authorization migration `0000000012` and its module-owned `authorization_core` schema are included in the reviewed migration catalog; startup still performs compatibility checks only and never applies migrations.
- Production composition now creates the PostgreSQL authorization store/recorder/service, Organization read resolver, PostgreSQL Audit service, and authentication-audit adapter through package public entry points.
- Policy readiness reloads the authoritative complete current policy after database probes and rechecks close, cancellation, and binding generation before publishing state. Slow or stale loads cannot restore readiness.
- No Permission, Role, Grant, policy, administrator, workforce fact, or readiness audit record is seeded or synthesized. Missing policy continues to fail closed.
- Independent review closed deterministic authentication operation identity, one-trace-per-logical-operation, same-command retry after uncertain audit commits, and slow-policy-load lifecycle races. The focused final re-review covered 37 tests with no residual finding.
- Detailed evidence and boundaries are recorded in `CMP-API-AUTH-PERSIST.md`; this integration does not add Registry/Form/File controllers or claim G3 completion.
