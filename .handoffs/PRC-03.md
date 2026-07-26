# PRC-03 Notifications Handoff

## Task

- Branch: `task/PRC-03-notifications`
- Worktree: `D:\AI-CRM-worktrees\PRC-03`
- Allowed paths: `packages/platform-modules/notifications/**`, `contracts/notifications/**`, `contracts/http/modules/notifications.openapi.yaml`, `.handoffs/PRC-03.md`
- Migration lease: `0000000009`
- Dependencies: PRC-01, PRC-02, ASY-01 and the accepted notification ADR/baseline documents
- Current status: `G2_ACCEPTED`

## Known Facts

- The first stage implements PostgreSQL in-app notifications and PC polling only.
- Notification intent, recipient snapshot, in-app state, Task state, domain state, and future provider delivery facts are separate.
- Business modules submit explicit intents with producer-scoped idempotency keys and stable recipient selectors.
- The authenticated actor is invocation context supplied separately to `submitIntent(actor, intent)`; it is not part of the versioned intent payload or its idempotency fingerprint.
- Recipient resolution uses a public injected port and stores the actual principal/recipient and resolution evidence/version.
- Templates are immutable versions, restricted Mustache plain text, and validated by JSON Schema before rendering.
- Safe deep links use Application Registry IDs, not arbitrary URLs. Target pages and APIs reauthorize current access.
- PostgreSQL facts remain authoritative under at-least-once asynchronous delivery.

## Allowed Assumptions

- The composing application supplies authorization, append-style audit, recipient resolver, preference decision, and safe observability ports.
- A first-stage preference decision is either `deliver` or `suppress`; no quiet-hours, delay duration, urgency, or mandatory category policy is inferred.
- A stable `principalId + recipientReference` identifies the same resolved delivery target within one intent. No cross-assignment natural-person merge is inferred.
- CMP-01 will compose worker/Outbox behavior without changing notification facts or treating transport status as read/completion.
- Integration Owner will update `pnpm-lock.yaml` in the shared dependency window for `mustache@4.2.0`; this task changes only its package manifest.

## Forbidden Assumptions

- No CRM entity, field, role, template, trigger, SLA, priority, retry count, recipient rule, or approval route is confirmed.
- No WeCom, WeChat, SMS, email, JPush, APNs, FCM, WebSocket, SSE, external address model, or concrete provider adapter is approved.
- Names, phone numbers, email addresses, `userid`, `openid`, or `unionid` are not identities or recipient selectors.
- Notification generation, provider acceptance/delivery, user read, Task completion, and business completion are never equivalent.
- Notification receipt never grants resource access and never bypasses target reauthorization.

## Non-goals

- API/Worker composition, RabbitMQ topology, generated OpenAPI bundle/client/manifest, PC UI polling implementation, external channel delivery, retry UI, and operator replay are outside this work package.
- No changes to `apps/**`, `pnpm-lock.yaml`, `contracts/generated/**`, `packages/api-client/**`, shared scripts/configuration, or other modules.

## Contracts and compatibility

- Added `contracts/notifications/notification-intent.v1.schema.json` and `template-release.v1.schema.json`.
- Added internal-only `contracts/http/modules/notifications.openapi.yaml` for list/detail/unread/read/archive.
- The source contracts are additive and business neutral. Generated files are intentionally deferred to the Integration Owner's single contract window.
- Public TypeScript imports are available only through `@ai-crm/platform-notifications`.

## Authorization and audit

- Template publishing, intent submission, list, detail, unread count, read, and archive each require server-side authorization.
- List/read/write stores are constrained by the authenticated principal; another principal receives an empty list or stable not-found result rather than object disclosure.
- Each authorized operation records attempted and succeeded/failed audit phases. Authorization or audit availability fails closed.
- Audit and observer inputs contain stable references/error codes only, never rendered title/body, variables, cookies, tokens, personal data, or provider payloads.

## Idempotency, transactions, and concurrency

- Intent idempotency key: `(producer,idempotency_key)` with a canonical SHA-256 request fingerprint.
- Exact duplicates return the original accepted result before repeated recipient resolution. Conflicting reuse fails with `NOTIFICATION_CONFLICT`.
- PostgreSQL serializes concurrent duplicates with a transaction-scoped advisory lock, then inserts intent and all recipient/in-app facts in one transaction.
- Notification IDs are deterministic from intent ID plus resolved principal/recipient reference. Duplicate selector results for the same exact target are removed without inferring natural-person merging.
- Mark-read and archive use `coalesce` and preserve the first timestamp.

## Migration

- `0000000009_notifications.sql` creates module-owned schema `platform_notifications`, immutable templates, intents, and in-app facts/indexes.
- It is additive and has no backfill or existing-table lock impact.
- Before first use, backup and empty-database migration evidence are required. After facts exist, rollback by dropping the schema is not permitted as an online downgrade; preserve history and forward-fix with a new global migration.

## Failure and recovery

- Invalid input/template/deep-link, missing template, empty/ambiguous resolver failure, authorization/audit failure, storage failure, and idempotency conflicts are explicit stable errors.
- Recipient resolver exceptions are retryable and fail closed; empty or over-limit results never broadcast.
- Mustache raw tags, sections, inverted sections, partials, comments, prototype access names, invalid schema, missing/unknown/invalid variables, and output limits fail before persistence.
- A committed in-app fact is not removed by later RabbitMQ/provider failure. CMP-01 must retry/isolate transport work without altering read state or business facts.

## Observability and secrets

- Observer dimensions are bounded operation/outcome/duration only. Logs/traces should use intent/notification/template version and hashed idempotency references, not content.
- No secret, provider credential, channel address, token, arbitrary URL, request/response body, or raw variable payload is stored in telemetry.
- This module introduces no runtime secret; PostgreSQL migration/runtime connection strings remain typed `*_FILE` inputs owned by composition/database infrastructure.

## Review matrix

| Concern | Result |
|---|---|
| Authorization | Explicit per operation; current-principal store scope; fail closed |
| Idempotency | Producer-scoped fingerprint, concurrent duplicate serialization, conflict tests |
| Transactions | Intent plus all in-app facts atomic in PostgreSQL |
| Migrations | Global `0000000009`, additive metadata and real PostgreSQL test |
| Observability | Stable bounded operation/outcome only; content excluded |
| Backward compatibility | Additive source contracts/module API; no generated output edited |
| Secrets | No new secrets or provider values |
| Failure modes | Stable errors; empty resolver fails; storage/retry semantics documented |

## Independent review round 1

The independent Reviewer reported four P2 findings against candidate `063b1d7`; the Owner fixed all four and added regression coverage:

1. Closed: aligned the JSON Schema and public TypeScript intent payload by moving the authenticated actor to invocation context. A retry by a different authorized actor now returns the original producer-scoped idempotent result without repeating recipient resolution.
2. Closed: the in-memory detail lookup now excludes `suppress` decisions, matching PostgreSQL list/detail/state behavior. Regression coverage proves a suppressed notification is neither listed nor readable by ID.
3. Closed: bounded technical observer failures are caught and cannot change either a successful business result or the original denied/error result. Audit remains authoritative and fail-closed.
4. Closed: cursors are validated at the service boundary with a 128-character maximum and exact `RFC3339 UTC timestamp + NUL + UUID` structure before Store access. Malformed and oversized cursor tests prove the Store is not called; valid cursor pagination remains covered.

No source contract or generated artifact changed in this round: the source JSON Schema already excluded actor. No Lockfile or generated-file window was required.

## Independent review round 2

The Reviewer confirmed all four Round 1 findings closed, then reported one new P1 authorization finding against candidate `33e97d7`: intent submission authorization was not explicitly bound to the claimed producer and therefore could not protect another module's producer-scoped idempotency namespace.

- Fixed: `NotificationAuthorization` now receives a validated, explicit `producerReference` for `notification_intent_submit` before `findIntent`, template lookup, recipient resolution, preference evaluation, or persistence.
- Regression coverage proves an actor authorized for the claimed producer can submit, an untrusted actor is denied before Store/Resolver access, and a separately authorized retry actor still receives the original idempotent result without repeated recipient resolution.
- The composing application remains responsible for binding authenticated calling subjects to approved producer references; a generic submit permission is insufficient.
- This is an additive TypeScript port clarification only. The versioned intent JSON payload, source HTTP surface, generated artifacts, and Lockfile do not change.

## Independent review round 3 and G2 acceptance

- The same independent Reviewer re-reviewed exact implementation candidate `9c7a1e91f51c7658ca5151dc8e2a842d6e686683` and closed the Round 2 P1 producer-authorization finding.
- Reviewer result: zero actionable findings and zero unresolved architecture or contract issues.
- Authorization, idempotency, transactions, migrations, observability, backward compatibility, secrets, and failure modes were explicitly rechecked. The Reviewer confirmed producer-bound denial occurs before module data access and that prior Round 1 findings remain closed.
- Reviewer independently ran module lint, typecheck, 18 ordinary unit/contract tests, build, and `git diff --check`; all passed. The ordinary run intentionally skipped the 3 isolated PostgreSQL tests.
- The Reviewer checked the Owner evidence for 3/3 real PostgreSQL integration tests and full `pnpm check` with 140/140 tasks passing.
- PRC-03 is accepted at G2. Merge sequencing and the final merge commit remain owned by the Integration Owner.

## Verification evidence

- Post-fix module unit/contract tests: 18 passed; the 3 PostgreSQL tests are intentionally skipped outside the isolated harness.
- Post-fix isolated real PostgreSQL integration: 3 passed on 2026-07-26.
- Post-fix module lint, typecheck, and build: passed on 2026-07-26.
- Post-fix `pnpm check`: 140/140 tasks passed on 2026-07-26, including repository, Compose, generated-contract integrity, build, lint, typecheck, tests, and package contract checks.
- Post-fix `git diff --check`: passed.
- `pnpm repo:check`: passed (8 repository/check tests).
- `pnpm compose:check`: passed.
- `pnpm exec turbo run build lint typecheck test contracts:check`: 140/140 tasks passed.
- `git diff --check`: passed.
- `open-code-review` CLI is installed, but `ocr llm test` could not run because no OCR LLM endpoint/credential is configured. No credential was invented; Owner completed a manual diff and review-matrix pass.
- Source candidate: `d96a4a8`.
- Integration Owner generated-artifact/Lockfile commit: `ee04db2` (generated internal OpenAPI, manifest, generated API Client operations, and `mustache@4.2.0` Lockfile resolution). Frozen offline install passed in that window.
- Post-generation `pnpm check`: 140/140 tasks passed on 2026-07-26; repository checks, Compose checks, generated-contract integrity, build, lint, typecheck, tests, and package contract checks all passed.
- Owner final review found no remaining executable finding in the task-owned paths. Shared generated files and Lockfile were inspected read-only after the Integration Owner commit.
- Independent review rounds, final accepted commit, and G2 evidence are appended only after the same Reviewer reports zero actionable findings.
