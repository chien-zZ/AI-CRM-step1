# AUTH-PERSIST-01 — Authorization policy persistence and publication

## Task card

- Owner: authorization persistence implementation line
- Date: 2026-07-28
- Decision basis: accepted ADR-0025
- Allowed paths: `packages/platform-modules/authorization/**`, new global migration lease `0000000012` owned exclusively by this task, and this handoff
- Forbidden paths: `apps/**`, other packages, `contracts/**`, root package/lockfile, and global migration registries

### Known facts

- PostgreSQL is the authoritative source for immutable policy snapshots, the committed current-version selection, publication history, and durable authorization decision records.
- Existing public runtime ports are `AuthorizationPolicyStore` and `AuthorizationDecisionRecorder`; snapshots are validated by the authorization core before use.
- A publication must atomically persist the complete immutable version, append the publication fact, and switch the current pointer under concurrency control.
- Repeating the same publication intent and content is idempotent; reusing an intent or version for conflicting content fails closed.
- Decision recording is append-only and idempotent by `decisionId`; conflicting content for the same ID fails closed.
- Empty, malformed, incomplete, unpublished, or digest-mismatched policy data must never be returned as an authoritative snapshot.
- Migration `0000000012` is reserved only for this task and production startup must not synchronize schemas.

### Allowed assumptions

- A module-private persistence runtime exposing parameterized `execute` and transaction-scoped `withTransaction` is structurally compatible with the repository database runtime without exposing PostgreSQL/Drizzle types.
- UUID publication IDs and the existing bounded policy version syntax are sufficient technical identifiers; they do not establish business roles or approval routes.
- SHA-256 over a deterministic canonical JSON representation is the stored content digest.
- The first implementation may publish immediately at the caller-provided UTC timestamp; scheduling and approval are excluded.
- PostgreSQL transaction advisory locks may serialize publication intents and the singleton current pointer.

### Forbidden assumptions

- No real Permission, Role, Grant, administrator, emergency-access rule, approval route, SLA, CRM entity, or seeded policy may be invented.
- Keycloak roles/claims, organization names/positions, Redis, process memory, or fixtures cannot establish authorization facts.
- Publication authorization or a production management HTTP endpoint is not inferred by this task.
- Decision records are not treated as the owning module's business audit or as atomically committed with a later business command.
- Failed cache invalidation does not authorize fallback to an older policy.

### Non-goals

- Application composition, controllers, production writer exposure, cache invalidation delivery, retention/archival jobs, scheduled publication, approval workflow, and policy administration UI.
- Changes to public HTTP/event contracts, other schemas, shared migration registration, secrets, or telemetry vendors.
- Production seed data or automatic migration execution.

### Deliverables and acceptance

- Additive reviewed migration `0000000012` with module-owned schema, immutability guards, constraints, publication/current-pointer facts, decision-record append-only facts, metadata, and recovery guidance.
- Production PostgreSQL implementations of `AuthorizationPolicyStore` and `AuthorizationDecisionRecorder` using only the module persistence abstraction.
- Transactional publication use case with deterministic digest validation, complete readback verification, serialization, and safe idempotent replay/conflict handling.
- Unit tests for canonicalization, empty/corrupt rejection, idempotency, conflicts, and transaction failure behavior.
- Real PostgreSQL integration tests covering empty migration, atomic/current visibility, concurrency/idempotency, database immutability, corrupt/empty fail-closed reads, and decision replay/conflict behavior.
- README/operator notes, migration recovery guidance, targeted checks, `pnpm check`, and a separate eight-area review of authorization, idempotency, transactions, migrations, observability, backward compatibility, secrets, and failure modes.

### Unresolved assumptions

- The production caller authorized to publish, approval/separation-of-duty route, retention periods, cache invalidation transport, and production readiness composition remain owner decisions. Consequently no production write endpoint or seeded current policy is created.

## Implementation evidence

- Added migration `0000000012_authorization_policy_persistence` with private physical schema `authorization_core`. The unquoted logical name `authorization` conflicts with PostgreSQL `CREATE SCHEMA ... AUTHORIZATION` grammar; ADR-0025 did not prescribe a physical name. The corrected reserved migration was rerun from an empty PostgreSQL 17.5 database before application or merge.
- Tables separate immutable complete policy versions, append-only publication history, the mutable singleton current selection, and append-only decision evidence. Composite foreign keys bind current selection and publication facts to the exact version digest. Update/delete triggers protect all historical facts. No data is seeded.
- `createPostgresAuthorizationPersistence` exposes store, publisher, and recorder ports while accepting only `AuthorizationPersistenceRuntime` (`execute` plus `withTransaction`). Production source imports no database client, Drizzle object, query builder, or transaction type.
- Policy publication validates the existing contract, rejects empty Permission/Role/Grant sets, canonicalizes semantic set ordering, computes SHA-256, serializes all publications with a transaction advisory lock, binds version to contract/content, appends the publication and switches current in one transaction, then validates full readback before commit.
- Replaying the same publication ID/fingerprint returns its original result without moving current state. Conflicting publication-ID reuse, version/content reuse, or contract-version reuse is rejected. PostgreSQL rollback leaves no partial version/publication/current facts when readback fails.
- Store reads require a committed publication fact, validate the current composite links, reconstruct a complete canonical snapshot, and recompute its digest. Missing, unpublished, empty, malformed, or digest-mismatched state raises a stable unavailable error consumed by the existing fail-closed engine.
- Decision records validate bounded public fields, are inserted once by decision UUID and canonical record digest, accept identical retry, reject conflicting ID reuse, and cannot be updated/deleted in PostgreSQL.
- README records migration application/recovery, no-readiness-without-policy, no startup synchronization, unresolved production writer/approval/retention/cache composition, and the explicit absence of default policy or administrator data.

### Verification

- `pnpm --filter @ai-crm/platform-authorization test`: 29/29 passed; the four PostgreSQL cases are intentionally skipped in the ordinary unit command unless its ephemeral Secret file is supplied.
- `pnpm --filter @ai-crm/platform-authorization test:integration`: 4/4 passed against isolated `postgres:17.5-alpine`, including empty migration/no seed, atomic publication/readback, concurrent serialization, replay, immutable triggers, corrupted empty-policy failure, decision idempotency/conflict, and container/Secret cleanup.
- `pnpm --filter @ai-crm/platform-authorization lint`: passed.
- `pnpm --filter @ai-crm/platform-authorization typecheck`: passed.
- `pnpm --filter @ai-crm/platform-authorization build`: passed.
- `pnpm --filter @ai-crm/platform-authorization contracts:check`: passed.
- `git diff --check -- packages/platform-modules/authorization .handoffs/AUTH-PERSIST-01.md`: passed.
- Full `pnpm check`: the implementation reached repository checks and identified the now-removed relative test import as a package-boundary violation. The harness now imports the public `@ai-crm/database` entry and authorization declares the workspace dev dependency. Per path ownership, the root `pnpm-lock.yaml` importer update and final rerun are assigned to the Integration Owner; this task did not modify the root lockfile.

## Eight-area review

1. Authorization: this task creates persistence mechanics but no production policy writer or bypass. No Permission, Role, Grant, administrator, approval route, identity inference, or default allow is added. Runtime evaluation still goes through the existing authorization service and mandatory recorder.
2. Idempotency: publication intent is keyed by UUID plus canonical fingerprint; identical replay returns the immutable original result and does not reset current. Policy version reuse requires identical contract/content. Decision UUID replay requires an identical canonical record digest. Conflicts fail closed.
3. Transactions: version insert, publication append, singleton pointer change, and verified readback execute inside one PostgreSQL transaction. A transaction-scoped global advisory lock provides one publication order. Tests prove rollback removes all partial facts. Decision recording is intentionally a separate authorization fact and does not claim distributed atomicity with business commands.
4. Migrations: global lease `0000000012` is additive, creates an empty module-owned schema, carries complete review metadata, and uses no startup synchronization/backfill/destructive SQL. Historical tables have database immutability guards. After first use, rollback retains facts and requires a newly leased forward fix; older policy restoration appends a publication.
5. Observability: no logger, metric, Trace exporter, or vendor SDK is introduced. Persisted decision evidence contains only the reviewed bounded fields and safe W3C Trace ID; it excludes token, cookie, Secret, claim, request/response body, resource context, SQL parameters, and provider payload. Production alert composition remains out of scope.
6. Backward compatibility: existing store/recorder interfaces and engine behavior remain unchanged; new public persistence/publisher types and factories are additive. Redis semantics and synthetic fixtures remain test-only. No HTTP/event contract or other module is changed.
7. Secrets: implementation introduces no credential or environment-value API. The PostgreSQL integration runner creates random temporary file-based credentials, never prints their value, binds them read-only, and removes the container and temporary directory in `finally`.
8. Failure modes: absent current policy, unpublished/missing version, empty/malformed content, digest mismatch, invalid identifiers/timestamps, conflicting retry, database constraint/immutability error, unavailable database, ambiguous transaction/readback, and recorder failure all deny or throw stable unavailable/conflict errors. Cache invalidation, production publication authorization/approval, retention and readiness wiring remain explicit owner follow-ups, not implicit success claims.

## Integration Owner follow-up

- Synchronize the `packages/platform-modules/authorization` importer in root `pnpm-lock.yaml` for the declared `@ai-crm/database: workspace:*` development dependency during the shared lockfile window.
- Run `pnpm install --frozen-lockfile`, `pnpm --filter @ai-crm/platform-authorization test:integration`, and full `pnpm check` after that synchronization. No application composition or production writer is authorized by this follow-up.

## Independent review loop

An independent persistence review identified four hardening gaps; the Owner addressed each without changing the migration or external contracts:

1. Canonical digest ordering no longer uses host locale collation. Policy normalization now uses explicit UTF-16 code-unit ordering throughout digest-relevant Permission, Role, Grant, scope dimension, term and value material. A `Z`/`a` regression proves stable ordering for characters whose locale collation commonly differs from code-unit order.
2. Decision records now enforce `allowed === (reason === "allowed")`. Before an allowed fact is inserted, the recorder loads the referenced published authoritative version and verifies its complete canonical content digest. Denied and policy-unavailable facts remain recordable when policy storage is absent, preserving fail-closed evidence.
3. Public persistence errors contain only the stable error name/code/message. Database query, transaction begin/commit, constraint and raw runtime errors are mapped without `cause`, SQL, credential material or provider text. Tests cover both query and transaction-runtime failures.
4. Real PostgreSQL coverage now includes simultaneous mixed-content writes for one Decision ID (one immutable winner and one stable conflict) and restoration of a historical version through a new publication whose `previous_policy_version` links to the version replaced. History retains both publications of the restored version.

A residual P2 review found that a timestamp matching the lexical UTC pattern but containing an invalid calendar date could reach `Date#toISOString` and throw a native `RangeError`. The recorder now checks `getTime()` before roundtrip formatting and maps such input to `authorization_decision_conflict`; a `2026-99-99T00:00:00.000Z` regression proves that no native error escapes.

Post-review verification: authorization unit suite 33/33 passed; isolated PostgreSQL 17.5 suite 5/5 passed; lint and typecheck passed. Build/contracts and final Integration Owner lockfile/full-workspace gates remain as listed above.

## Integration review hardening (2026-07-28)

- A later independent integration review found that syntactically valid unknown policy contract versions could be stored and read as V1. Publication, current-version resolution, and version loading now accept only `authorization-policy.v1`; unknown versions fail closed.
- The same review found that policy-derived denied decisions could reference an unpublished policy version. All evaluations backed by a policy, whether allowed or denied, now load the immutable published version before recording. Only `policy_unavailable`, `policy_invalid`, or pre-policy `invalid_context` may use the explicit `unavailable` sentinel.
- Regression verification: authorization unit suite 34/34 passed and isolated PostgreSQL 17.5 integration suite 5/5 passed. No migration, policy seed, Permission, Role, Grant, or production publisher was added.
