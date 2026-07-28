# CMP API Runtime Capability Composition

- Status: COMPLETED; independently reviewed and repository check passed
- Owner: CMP-01 Integration Owner
- Date: 2026-07-28
- Allowed paths: `apps/api/**`, CMP handoffs, and the execution board

## Known Facts

- Migration `0000000013` defines the reviewed least-privilege `ai_crm_runtime` grants and fails when that prerequisite role is absent.
- `@ai-crm/database` exposes a read-only probe that verifies the exact runtime identity and rejects elevated role attributes, inherited memberships, database create/temporary capability, and public-schema access.
- Application Registry and Form Schema expose independent read-only PostgreSQL probes for the exact columns and privileges used by their explicit production query projections.
- File storage/scanner Providers remain unresolved, and no complete production authorization policy has been published.

## Allowed Assumptions

- API composition may run the three public probes through the existing bounded database dependency lifecycle.
- Each capability may cache only its own current-generation result and may recover after its prior underlying query settles.
- A module capability is healthy only when database health and the exact runtime-role probe are both healthy.

## Forbidden Assumptions

- Generic database health, migration compatibility, constructor success, or a privileged database connection never proves runtime capability.
- A timed-out underlying SQL call must not be overlapped by another call of the same probe.
- Probe availability does not replace request authorization or guarantee that a future query succeeds.
- No real policy, Role, Grant, publication Owner, File Provider, Task runtime value, or production Secret is invented.

## Non-goals

- No authorization publication HTTP endpoint or production bootstrap authority.
- No COS/ClamAV Adapter, Worker consumer activation, CRM module, external contract, or Secret value.

## Implementation

- API production composition creates the runtime-role, Registry, and Form probes only through public package entry points.
- Dependency probes have independent non-overlapping in-flight guards. One stuck query cannot freeze database health or another module probe; the same probe retries only after its underlying call settles.
- Abort, close, database loss, old generations, timeout, malformed results, missing privileges, or the wrong connection role clear or retain unhealthy readiness without publishing late results.
- `database-runtime-role` is a required readiness item. Authorization, Audit, Registry, and Form readiness also require that role capability, so a migration/owner connection cannot pass readiness through positive module checks.
- Registry and Form fixed-false readiness entries are replaced by their current bounded module capability status. File remains fixed unavailable.

## Independent Review

- Round 1 found a startup-abort state leak, a lint/type issue in the in-flight guard, and requested proof that a stuck probe can recover without overlapping SQL.
- Fixes reset only the active generation on startup failure, preserve newer generations, use a fully typed five-key guard table, and prove that other probes continue while a stuck Audit query remains non-overlapping and then recovers on the next interval after settlement.
- The same Reviewer rechecked API build/typecheck, lint, focused tests, generation/abort behavior, Promise settlement, and readiness invalidation. All findings are closed with no new P0-P3.

## Verification

- API focused Composition Factory tests: 21/21 passed.
- API `build`, `typecheck`, and `lint`: passed.
- `git diff --check`: passed.
- Full repository `pnpm check`: passed; Repository 40/40 and Turbo 140/140 successful, including API 170 passed/5 gated skipped and Worker 90/90.
- The first full run encountered a transient Worker coverage temp-file `ENOENT`; the standalone Worker suite passed 90/90, and the complete clean rerun then passed 140/140.

## Remaining G3 Blockers

- Approve the first-policy bootstrap authority, publication Owner/permission, review/emergency route, management Audit Adapter, and a real non-empty policy; then publish it through the protected boundary.
- Resolve and implement the COS/ClamAV Provider configuration and acceptance environment.
- Approve Task projection retry, timeout, flow-control, capacity, and alert values before activating Worker consumers.
