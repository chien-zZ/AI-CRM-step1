# API Production Composition

- Status: REVIEW_FIX_VERIFIED
- Owner: CMP-01 API production composition line
- Allowed paths: `apps/api/**` and this handoff

## CMP-API-DB-READY Task Boundary

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
- A stopped, aborted, timed-out, or superseded probe may update readiness or schedule another timer.
- Health output may expose SQL, connection details, dependency errors, topology, or Secret values.

### Non-goals

- No authorization policy, authentication audit, Organization, protected Controller, RabbitMQ, Worker, Compose, migration, contract, or Lockfile change.
- No production availability, failover, SLA, RPO, or RTO claim.
- No replacement for operator monitoring or a transaction-level database failure policy.

## Known Facts

- API has reviewed PC BFF authentication routes and a principal -> workforce context -> authorization chain.
- `@ai-crm/database` publicly exposes a bounded PostgreSQL runtime and read-only migration compatibility checker.
- The API authentication boundary publicly exposes file-backed BFF configuration, Redis session storage, OIDC discovery, token verification, and HTTP/session adapters.
- No reviewed durable `AuthorizationPolicyStore`, `AuthorizationDecisionRecorder`, or authentication-audit adapter exists at the application boundary.
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
- Readiness tracks migration compatibility and live Redis client readiness, but remains unavailable while authorization policy and authentication audit are unresolved.
- After migration compatibility succeeds, Readiness also tracks a cached, bounded `DatabaseRuntime.healthCheck()` loop. Probes do not overlap; timeout, rejection and unavailable results fail closed, later success recovers, and shutdown/abort invalidates timers and late results before resource close.

## Authorization And Audit

- Authorization remains default-deny through the existing `AuthorizationUnavailableError` boundary.
- Workforce and protected query operations remain unavailable; no synthetic organization or policy data is used in production.
- Authentication state-changing operations require the session service audit port. The unresolved production adapter rejects audit recording, so login/session mutations fail closed and clean up transient session state according to the existing session-service tests.
- No audit record, authorization decision, or successful protected operation is fabricated.

## Idempotency, Transactions, And Failure

- This composition adds no domain command or idempotency contract.
- Redis session Lua operations retain their reviewed atomicity and session rotation semantics.
- Migration compatibility is read-only and does not open an application transaction or acquire a migration lock.
- PostgreSQL, Redis, OIDC, JWKS, Secret, compatibility, and cleanup failures reject initialization or readiness without exposing credentials or dependency details through HTTP health output.

## Observability And Compatibility

- Existing API lifecycle logging records stable operation/error categories without Secret values, bodies, tokens, SQL parameters, or provider payloads.
- Health responses remain the existing `{status}` contract; internal dependency labels are not serialized.
- Development/test synthetic bindings retain their previous behavior. `ApiPlatformBindings.close` is optional for source compatibility; production supplies it.
- `apps/api/package.json` now declares `@ai-crm/database`; the Integration Owner must update the root Lockfile once after parallel lines merge.

## Verification

- API ordinary suite: 85 passed, 5 dependency integration tests skipped; the isolated PostgreSQL/Redis/Keycloak gate passed all 88 tests before the final two process-only regression cases and cleaned its resources.
- Focused typecheck, lint, build, and contract checks are required before merge.
- Real PostgreSQL/Redis/Keycloak integration gates remain the Integration Owner's responsibility after production Compose wiring is merged.

## Unresolved Questions And G3 Blockers

- What reviewed durable store owns authorization permissions, roles, grants, policy versioning, and decision records?
- How are authentication audit events mapped to durable audit facts with actor, operation, trace, retention, and failure semantics without inventing evidence?
- What production image path supplies all migration source files, and how is its catalog integrity tied to the immutable release artifact?
- Resolved by CMP-API-DB-READY: the synchronous health dependency reads a bounded application cache maintained by the public `DatabaseRuntime`; it does not execute a fresh query per request.
- CMP-01 remains IMPLEMENTING and E2E-01 remains blocked until these items and the other G3 lines are closed.

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
- Authorization policy and authentication audit remain deliberate production Readiness blockers, so CMP-01 remains IMPLEMENTING and E2E-01 remains blocked.
- Independent review found one P1 overlapping-query risk after an application timeout and no other finding. The scheduler now waits for underlying settlement, and regression coverage proves advancing multiple timeout/interval windows cannot start a second query while the first is pending.
