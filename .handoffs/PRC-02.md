# PRC-02 Task Center

- Status: second independent-review finding repaired; Agent C re-review pending
- Branch: `task/PRC-02-task-center`
- Owner: Agent A (L1)
- Independent Reviewer: Agent C (round 2 complete; re-review required)

## Objective

Provide a business-neutral, replayable and reconcilable unified task projection. Authoritative sources retain task and business state; Task Center routes commands back to those sources.

## Known Facts

- ADR-0009 makes Workflow or a future owning module the task fact source. Task Center is a query projection, not an approval or domain-state owner.
- ASY-01 supplies durable at-least-once Eventing/Outbox/Inbox primitives. Application consumer composition remains CMP-01 work.
- Deep links must use stable Application/Route identifiers, and every detail access/action must be authorized server-side.
- Migration number `0000000004` was allocated to PRC-02.

## Allowed Assumptions

- A source exposes a stable `sourceType + sourceTaskId`, a monotonically increasing positive `sourceVersion`, and a stable idempotent command endpoint through project-owned ports.
- Lifecycle events may be duplicated, delayed, reordered, lost, and replayed.
- First-stage task state is limited to business-neutral `open`, `completed`, and `cancelled` projection values.
- Synthetic stable identifiers may be used only in tests.

## Forbidden Assumptions

- No CRM entity, field, title, workflow route, approver role, candidate rule, SLA, reminder, priority, retention period, or domain state is inferred.
- Task Center does not call Flowable directly, query another module's tables, or treat Workflow/Flowable types as public contracts.
- Notification read/delivery state never changes a task projection.
- Deep links cannot contain a URL, route payload, credential, personal data, or customer content.
- Source acceptance never proves task completion; only a newer authoritative lifecycle event can close a projection.

## Non-goals

- Application/Worker composition, RabbitMQ topology, notification creation, reminders, background scheduling, UI integration, generated clients, and production source adapters are excluded.
- Claim/release/reject commands and CRM-specific filtering are not introduced without reviewed contracts.

## Contract And Public Interface

- Add internal OpenAPI source for authorized list, detail, completion-command routing, and reconciliation.
- Add a transport-neutral task projection lifecycle Event v1 data schema with stable source/version/status and `appId + routeId` only.
- Export a Task Center facade, storage/source/auth/audit/observer ports, stable error codes, and memory/PostgreSQL store constructors through the package root.
- Source routers must honor the supplied idempotency key. A retried timeout may reach a source that already accepted the command.

## Migration And Recovery

- Add `0000000004_task_center_projection` under module-owned `platform_task_center` with projection, processed-event receipt, and source-command receipt tables.
- Event receipt and version-guarded projection update share one PostgreSQL transaction and task-scoped advisory lock. No cross-module foreign key or table access exists.
- Migration is additive. Before consumers start, recovery may restore the pre-deployment backup. After accepted commands exist, retain receipts and forward-fix; projections can be rebuilt from authoritative source events. A `running` receipt has a bounded lease and may be atomically taken over after expiry; recovery always redrives the source command with the original idempotency key.
- Runtime startup does not synchronize schemas; the migration entry point requires `DATABASE_MIGRATION_URL_FILE`.

## Authorization, Audit, Idempotency And Failure

- List first authorizes the operation and then checks every returned projection; detail, complete, and reconcile authorize the current object every time and fail closed.
- Authorized reads/actions record attempted and terminal audit phases. Audit and authorization dependency failures are explicit retryable errors; denials are explicit non-retryable errors.
- Same event ID and payload returns `duplicate`; event ID payload conflict is rejected; a lower/equal new event version is recorded and returns `stale` without changing the projection.
- Completion atomically claims a bounded durable lease for an actor/task fingerprint by idempotency key. A duplicate accepted request returns the stable source result; a conflicting key is rejected; an active lease reports retryable in-progress; an expired same-fingerprint lease can be taken over.
- Source failure releases the local running reservation so the same idempotency key can recover. The source port remains responsible for remote idempotency across ambiguous network outcomes.
- Source adapter results are runtime validated as an exact `{ sourceCommandId, status: "accepted" }` object before a receipt is accepted. Malformed results are retryable source failures and leave no accepted receipt.
- Reconciliation fetches one authoritative snapshot, validates its requested key, and applies the same event/version rules. Source outage never changes local state or fabricates completion.

## Observability And Secrets

- Observer output is bounded to operation, outcome, and duration. It excludes event bodies, source payloads, actor/customer content, SQL parameters, URLs, credentials, and tokens.
- Health/readiness and alert thresholds are composition concerns for CMP-01/OPS-01; no vendor telemetry dependency is introduced.
- Source, tests, contracts, migrations, and commands contain no Secret values. Integration uses ephemeral `*_FILE` Secret references and removes its Compose project and volume.

## Backward Compatibility

- Public package exports, source contracts, schema, and tables are additive. Existing Workflow event schemas and public interfaces are unchanged.
- Generated internal/external OpenAPI, manifest, API Client, and `pnpm-lock.yaml` are intentionally not modified under the shared-resource lease.

## Shared Change Requests

- Integration Owner must run the reviewed contract generation window and commit the resulting `contracts/generated/*` and `packages/api-client` changes. The external bundle should remain unchanged in exposed operations because all Task Center operations are internal-only, though deterministic artifact metadata may change.
- Integration Owner must update `pnpm-lock.yaml` for the added existing workspace dependency (`@ai-crm/database`) and then verify with a frozen Lockfile.
- CMP-01 must compose Eventing consumer validation, authorization/audit adapters, source router/reader adapters, and operational health without importing Task Center internals.

## Independent Review Round 1 And Repairs (2026-07-26)

Agent C reported five actionable findings:

1. P1: event/command fingerprints depended on JSON property insertion order. Fixed with recursive stable-key serialization in both memory and PostgreSQL receipt paths; reordered nested event properties now deduplicate while substantive changes conflict.
2. P1: runtime `occurredAt`/`dueAt` validation accepted values outside the reviewed UTC RFC3339 contract. Fixed with the reviewed UTC-only shape, semantic date parsing, and shared boundary tests for no fraction and 1-9 fractional digits; offsets, missing seconds, excessive fractions, and invalid dates are rejected.
3. P1: `running` command receipts had no recovery ownership or takeover path. Fixed with bounded leases, atomic expired-lease takeover, token-owned accept/release, and tests for active leases, stale owners, pre-source interruption, and post-source/pre-receipt interruption. Redrives retain the original source idempotency key; no exactly-once claim is made.
4. P2: source adapter results were trusted without runtime validation. Fixed with exact-object validation and retry tests for null, arrays, invalid IDs, invalid status, and extra properties.
5. P2: the external generated OpenAPI bundle exposed internal Task Center schemas. Integration Owner fixed audience-reachable schema pruning in commit `a23d93b`; repository contract tests verify the external audience bundle contains only schemas reachable from allowlisted paths.

All five findings have repair evidence, but PRC-02 remains below G2 until the same Agent C re-reviews the complete diff and reports zero actionable findings.

### Independent Review Round 2 Repair (2026-07-26)

Agent C found one remaining P1: the UTC lexical pattern combined with `Date.parse` accepted calendar values that JavaScript silently normalized, including a non-leap-year February 29, April 31, and `24:00:00`. Runtime validation now checks Gregorian leap-year/month-day limits and `00-23:00-59:00-59` fields directly without normalization. Regression coverage applies each invalid value independently to both `occurredAt` and `dueAt`, and confirms a valid leap day plus the reviewed 0/1/9 fractional-second boundaries. The lexical JSON Schema boundary remains unchanged; runtime provides the required calendar-semantic validation that a pattern alone cannot express.

This P1 has repair evidence, but PRC-02 remains below G2 until Agent C re-reviews the exact repair commit and the full original finding set.

## Owner Self-review (2026-07-26, after round 1 repairs)

- Authorization: no default-allow implementation exists; all query/action methods use injected fail-closed authorization, with per-object filtering for list results.
- Idempotency: canonical event receipts, source versions, command fingerprints, stable accepted results, concurrent PostgreSQL locks, lease takeover, duplicates, conflicts, and retries with the unchanged source idempotency key are covered.
- Transactions: projection/event receipt updates are atomic. Remote source calls are explicitly outside database transactions and protected by source idempotency plus durable command state; no distributed transaction is claimed.
- Migrations: additive, globally numbered, module-owned, reviewed metadata complete, no cross-schema dependency, auto-sync, `push`, or destructive SQL.
- Observability: bounded safe observer fields and explicit failures; no payload logging. Composition-owned readiness is documented rather than fabricated.
- Backward Compatibility: additive v1 source contracts and root exports; existing Workflow/Eventing interfaces remain unchanged.
- Secrets: no values or provider credentials are stored; test Secret files are ephemeral and removed.
- Failure Modes: denied/unavailable authorization, audit/storage/source failure, malformed source results, active/expired/stale-owner command leases, duplicate/conflicting commands, stale/duplicate/conflicting events, lost/late events, and reconciliation recovery are explicit.

Owner review repaired: duplicate accepted commands now close their audit phase; storage failures during projection apply are normalized; stale authoritative reconciliation snapshots no longer report `current`; same-version authoritative snapshots can repair projection drift without permitting older snapshots to overwrite newer state.

## Verification Evidence

- `pnpm --filter @ai-crm/platform-task-center lint`: passed.
- `pnpm --filter @ai-crm/platform-task-center typecheck`: passed.
- `pnpm --filter @ai-crm/platform-task-center build`: passed.
- `pnpm --filter @ai-crm/platform-task-center test`: 35 tests passed; 3 PostgreSQL tests skipped by the unit runner as intended.
- `pnpm --filter @ai-crm/platform-task-center test:integration`: 3/3 passed against isolated PostgreSQL, including root/module migrations, canonical event deduplication, atomic lease takeover, stale-owner isolation, stable accepted receipts, ambiguous interruption redrive, source-side idempotency, and Compose cleanup.
- `pnpm contracts:check`: passed; source/generated consistency and audience-reachable schema pruning are verified.
- `pnpm check`: passed, 140/140 tasks successful.
- `git diff --check`: passed.
- Independent re-review is pending. This handoff must not be marked `G2 accepted` until Agent C reports zero actionable findings after any further repair loops.
