# CLI-02 Internal Mobile H5 Handoff

## Objective

Deliver the business-neutral Taro H5 shell for internal mobile use without fabricating an internal-mobile BFF, provider login, Notification API, Form API, or CRM domain facts.

## Known Facts

- ADR-0015/0016 require an independently deployable Taro H5 application using React, TypeScript, and NutUI React; Ant Design and ProComponents are forbidden.
- ADR-0017 requires an isolated BFF HttpOnly-cookie session. Browser code must not receive or persist Keycloak tokens or provider secrets.
- ADR-0018 requires server-established subject/workforce-person/active-employment checks. Client navigation never grants access.
- Task Center has passed G2 and its generated internal operations are available. Internal-mobile session, Notification, and Form contracts are not available to CLI-02.
- The repository has no remote branch protection. Only the Integration Owner may update `main` and `pnpm-lock.yaml`.

## Allowed Assumptions

- A client-owned port may isolate the shell from pending BFF composition.
- Development and tests may use visibly labelled synthetic Fixture data selected by a build-time development runtime alias.
- Production may fail closed to maintenance until reviewed session and generated-client adapters are composed.
- URL state may contain only bounded presentation state (`page` and a stable synthetic/reference ID).

## Forbidden Assumptions

- No CRM entity, role, position, department, SLA, approval route, person, email channel, business metric, or provider identity is confirmed.
- Notification and Form pages do not imply reviewed APIs or production data availability.
- Fixture objects are not API DTOs, authorization results, audit evidence, or persistent facts.
- No Keycloak token, cookie value, provider identifier, personal/customer content, credential, or Secret may enter storage, URL state, logs, fixtures, or production artifacts.

## Non-goals

- No backend/BFF implementation, provider federation, persistence, write command, audit record, migration, notification delivery, form submission, file upload, CRM page, AI use case, native application, or Mini Program artifact.
- No modification to `apps/api`, `apps/worker`, contracts, generated artifacts, root Lockfile, or other Owner paths.
- No claim that independent review or G2 acceptance is complete.

## Implementation Result

- Taro 4.2.1, React 18.3.1, TypeScript, and NutUI React 3.0.20 H5 application with independently registered Home, Task, Notification, Form, and status pages.
- Narrow Navigation, Connectivity, FilePicker, Session, and Transport adapters. Transport sends same-origin Cookie credentials and never constructs an Authorization header.
- Generated internal Client allowlist restricted to `listTasks` and `getTask`; write operations and pending module operations are excluded.
- URL-restorable and canonical `page`/`selected` state with malformed, overflowing, and unknown values normalized safely.
- Explicit loading, maintenance, forbidden, session-expired, unavailable, offline, retry, logout, and pending-login-contract behavior.
- Development runtime dynamically imports a labelled synthetic Fixture. Production uses a separately aliased fail-closed runtime so Fixture code is absent from artifacts.
- Responsive layout covers the 320px floor and 390px-class viewports, safe-area padding, keyboard focus, landmarks, live status, and assertive connectivity alerts.
- Production bundle gate rejects source maps, Fixture markers, sensitive patterns, and entrypoints over 600 KiB. Current entrypoint is 540,927 bytes.

## Contract, Migration, And Shared Resource Requests

- No public contract, generated Client, database schema, or migration change is included.
- Integration Owner must update `pnpm-lock.yaml` from `apps/internal-mobile/package.json` in the serialized Lockfile window, then run installation and full checks with the frozen Lockfile.
- CMP-01 or a later reviewed client-composition package must supply the internal-mobile BFF/session adapter and future generated Notification/Form adapters only after their contracts pass G2.

## Review Checklist

- Authorization: presentation-only routes; generated Task reads still require server authorization; production fails closed without BFF composition.
- Idempotency: no write command, optimistic success, or persistent mutation exists. Retry only repeats bootstrap reads.
- Transactions: not applicable; the client owns no database, transaction, Outbox, Inbox, or ACK.
- Migrations: not applicable; no schema or runtime synchronization exists.
- Observability: no telemetry SDK or payload logging is introduced. UI errors use bounded generic text without response bodies or identifiers.
- Backward Compatibility: existing `applicationId` remains exported; new adapter and route helpers are additive. PC Web React/NutUI dependencies are not shared or assumed.
- Secrets: Cookie values are inaccessible to JavaScript; no token/secret storage or production artifact match exists.
- Failure Modes: dependency rejection, offline transition/recovery, forbidden, maintenance, expired session, unavailable service, login-contract pending, file cancellation, logout success/failure, malformed URL state, and production Fixture exclusion are explicit.

## Verification Evidence

- `pnpm --filter @ai-crm/internal-mobile build`: passed; Taro production H5 compiled and the bundle gate reported `540927/614400` bytes.
- `pnpm --filter @ai-crm/internal-mobile lint`: passed.
- `pnpm --filter @ai-crm/internal-mobile typecheck`: passed.
- `pnpm --filter @ai-crm/internal-mobile test`: 6 files, 27 tests passed.
- `pnpm repo:check`: passed.
- `pnpm check`: passed; 140/140 tasks successful. Turbo emitted only the existing informational note that `@ai-crm/internal-mobile#test` has no configured output files.
- `git diff --check`: passed.
- Production artifact checks: development Fixture markers absent; source maps absent; credential/private-key/session-key patterns absent.
- Lockfile: intentionally unchanged; frozen-Lockfile/full-repository verification remains an Integration Owner serialized-window requirement.

## Review Status

- Owner self-review: complete with zero open Owner findings. Authorization, idempotency, transactions, migrations, observability, backward compatibility, secrets, failure modes, business neutrality, Fixture isolation, route recovery, accessibility, and Cookie transport were checked.
- Independent Review Round 1 on candidate `981cb0e`: Agent A reported three P2 and one P3 finding covering transport allowlist bypass, non-keyboard-accessible collection entries, missing initial connectivity read, and silent pending-login behavior on the direct status route.
- Round 1 fixes: transport types are narrowed and canonical generated operation ID/method/path are verified before I/O; collection entries use native focusable buttons; connectivity reads initial Taro network state before leaving loading; the direct status route exposes the same fail-closed pending-login notice. Regression tests cover all four findings, including negative transport calls that assert no request occurs.
- Independent Review Round 2 on candidate `4d0a600`: all four Round 1 findings were closed. Agent A reported one new P2 ordering race where a delayed initial connectivity query could overwrite a newer network-change event.
- Round 2 fix: once a subscribed connectivity event is observed, the initial query may no longer update state. A deferred-Promise regression test proves a stale online snapshot cannot overwrite a newer offline event.
- Independent Review Round 3 on candidate `7fd281c`: the ordering-race finding was closed. The original Reviewer reported zero actionable findings, zero unresolved architecture/contract issues, and no new findings after rechecking initialization rejection, effect cleanup, and subscription ordering.
- Review result: all executable findings are closed; scoped tests, production build, bundle gate, and `pnpm check` pass.
- G2 acceptance: accepted by the Integration Owner after Agent A reported zero actionable findings and zero unresolved architecture/contract issues on candidate `7fd281c`; final branch-tip changes after that candidate are handoff evidence only.
