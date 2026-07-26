# PRC-03 Notifications Handoff

## Task

- Branch: `task/PRC-03-notifications`
- Worktree: `D:\AI-CRM-worktrees\PRC-03`
- Allowed paths: `packages/platform-modules/notifications/**`, `contracts/notifications/**`, `contracts/http/modules/notifications.openapi.yaml`, `.handoffs/PRC-03.md`
- Migration lease: `0000000009`
- Dependencies: PRC-01, PRC-02, ASY-01 and the accepted notification ADR/baseline documents

## Known Facts

- The first stage implements PostgreSQL in-app notifications and PC polling only.
- Notification intent, recipient snapshot, in-app state, Task state, domain state, and future provider delivery facts are separate.
- Business modules submit explicit intents with producer-scoped idempotency keys and stable recipient selectors.
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

## Verification evidence

- Module unit/contract tests: 15 passed; the 3 PostgreSQL tests are intentionally skipped outside the isolated harness.
- Isolated real PostgreSQL integration: 3 passed on 2026-07-26.
- `pnpm repo:check`: passed (8 repository/check tests).
- `pnpm compose:check`: passed.
- `pnpm exec turbo run build lint typecheck test contracts:check`: 140/140 tasks passed.
- `git diff --check`: passed.
- `open-code-review` CLI is installed, but `ocr llm test` could not run because no OCR LLM endpoint/credential is configured. No credential was invented; Owner completed a manual diff and review-matrix pass.
- `pnpm contracts:check` and the umbrella `pnpm check` remain pending the Integration Owner's exclusive generated OpenAPI/API Client/manifest and Lockfile window. PRC-03 does not modify those shared files before that lease.
- Source candidate commit, post-generation verification, independent review rounds, final commit, and timestamps are appended after completion.
