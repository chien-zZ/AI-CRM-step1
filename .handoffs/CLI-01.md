# CLI-01 PC Workbench Web Handoff

## Objective

Deliver the business-neutral PC workbench shell for CLI-01 without treating the earlier Demo preview or development fixtures as production facts.

## Known Facts

- ADR-0001 requires React 19, Vite, Ant Design 6, ProComponents, React Router, TanStack Query, and generated OpenAPI clients.
- PC Web authentication is a same-site BFF HttpOnly-cookie session. Browser code must not receive or persist Keycloak tokens.
- Task, notification, form, and file contracts/adapters are not all available to this branch at G2; CLI-01 must not invent them.
- This branch started from protective WIP commit `45df472`, which rebuilt the Demo shell but included unconfirmed student, position, SLA, email, people, department, search, and metric content.
- The repository currently has no remote branch protection. Only the Integration Owner may update `main`.

## Allowed Assumptions

- A frontend-owned `WorkbenchPort` may isolate the shell from not-yet-generated adapters.
- Explicitly labelled synthetic data may be enabled by Vite development mode and injected by tests.
- The production build fails closed to maintenance until the Integration Owner composes reviewed generated-client adapters.
- Platform-neutral routes may cover unified tasks, in-app notifications, forms, files, the active assignment context, and personal settings.

## Forbidden Assumptions

- No CRM entity, role, position, department, SLA, approval route, business metric, person, email channel, global CRM search, or business state is confirmed here.
- Fixture objects are not API DTOs, server facts, authorization results, or persistent state.
- Route or button visibility does not replace server-side authorization.
- No Keycloak token, provider secret, session handle, personal data, or customer content may enter browser storage, logs, URL state, or fixtures.

## Non-goals

- No backend, contract, generated client, API/Worker composition, provider login, persistence, write command, audit event, migration, CRM page, AI assistant, or multi-theme experiment.
- No Umi, HeroUI, Demo Store, Action Engine, `/dept3/*` route, or `localStorage` business state.
- No claim that independent review or G2 acceptance is complete.

## Allowed Paths

- `apps/workbench-web/**`
- `.handoffs/CLI-01.md`
- Removal of WIP changes to `packages/eslint-config/index.mjs` and `pnpm-lock.yaml` by restoring the `main` versions only

## Contract And Migration Changes

- None. `WorkbenchPort` is a client-side composition boundary, not a public HTTP schema or duplicate API DTO.
- No database access or migration exists in this package.

## Implementation Result

- ProLayout-based responsive application shell with explicit React Router routes and TanStack Query session/bootstrap recovery.
- Business-neutral navigation and pages for work overview, tasks, notifications, forms, files, and personal settings.
- URL-restorable `tab`, `filter`, `page`, and `selected` collection state plus longest-prefix navigation matching.
- Explicit 403, 404, 500, offline, session-expired, and maintenance presentations.
- Direct status routes expose route-appropriate return, login, or bootstrap-refetch recovery actions; lazy route failures are contained by an explicit reload boundary.
- BFF login entry and a fail-closed production runtime port. Development-only/test-only fixture content is visibly labelled synthetic.
- Master-detail platform collection layout, keyboard-focus treatment, accessible labels, empty states, and responsive behavior.
- Fixed same-site `/auth/pc/login` construction with the authentication contract's bounded local `returnTo` rules; bootstrap data can no longer inject a login URL.
- Explicit logout pending, error/retry, signed-out, and expired-session convergence; no logout Promise is discarded.
- ProLayout receives longest-prefix leaf selection and parent open keys, including collection object deep links.
- Route-specific lazy chunks and a manifest-driven bundle budget covering individual chunks, entry, static initial imports, and each lazy route's complete static import closure.
- Connectivity loss is announced through a semantic live alert and reserves its own layout height below the fixed header.

## Demo Reference Differences

- Uses ProLayout `mix`/split navigation instead of copying the Demo's custom dual Sider implementation. The reviewed implementation fixes the header at 48px, the secondary Sider at 184px, preserves explicit parent/leaf selection, and uses fluid content up to 1680px.
- Removes the Demo's role switcher, global CRM search, clock, mail, calendar, business home, business counts, named people, department labels, SLA wording, AI assistant, and theme experiments.
- Keeps the compact 48px-class workbench rhythm, two-level information hierarchy, master-detail pattern, URL-restorable context, and explicit feedback states.

## Shared Resource Requests

- Integration Owner must update `pnpm-lock.yaml` from `apps/workbench-web/package.json` in the serialized Lockfile window, then run with `--frozen-lockfile`.
- FND/Integration Owner must extend the shared ESLint configuration from `**/*.ts` to `**/*.{ts,tsx}` and the test override from `**/*.test.ts` to `**/*.test.{ts,tsx}`. This branch does not retain the WIP shared-config edit.
- After Task, Notification, Form, File, App Registry, and session contracts pass G2, the Integration Owner must compose a reviewed generated-client `WorkbenchPort` adapter. Until then, production intentionally renders maintenance.

## Review Checklist

- Authorization: client navigation is presentation only; production data adapter fails closed and server authorization remains mandatory.
- Idempotency: no write commands exist. Bootstrap has no client-side mutation or optimistic success.
- Transactions: not applicable; no persistence, Outbox, Inbox, ACK, or transaction handle exists.
- Migrations: not applicable; no schema or database dependency exists.
- Observability: no sensitive telemetry was added. Errors expose stable generic copy and no response body, token, cookie, or personal data.
- Backward Compatibility: public `applicationId` export remains unchanged; root `/` redirects to `/workspace`.
- Secrets: source, fixtures, URLs, and build configuration contain no credentials or real identifiers.
- Failure Modes: loading, fetch failure, signed-out, expired, maintenance, offline, forbidden, missing route, login-return validation, logout pending/error/retry, direct-status refetch/return behavior, and lazy-chunk recovery are explicit.

## Independent Review Round 1 Remediation

All entries below are implemented by the commit titled `CLI-01: resolve independent review findings`; the original Agent A reviewer must re-review them before G2 is considered.

| Finding | Resolution | Regression evidence |
|---|---|---|
| P1 injectable `loginUrl` and unsafe `returnTo` | Removed `loginUrl` from `BootstrapResult`; `pcLoginUrl` always targets `/auth/pc/login` and mirrors the reviewed 512-character local-path restrictions. | `constructs only the fixed same-site login entry with a bounded local returnTo` |
| P1 discarded logout Promise | `WorkbenchPort.logout` returns an explicit signed-out/session-expired result; Shell renders pending and retryable error states and converges Query session state only on success. | Pending/success and failure/retry logout tests |
| P2 longest-prefix match not connected | ProLayout now receives normalized `location`, `menuProps.selectedKeys`, and parent `openKeys`; object deep-link routes render their owning collection; linked `/coordination` and `/resources` parents redirect to stable default children. | ProLayout deep-link test, parent redirect tests, and navigation parent/leaf unit test |
| P2 inconsistent tab/filter/page/selected | Collection state validates Tab/filter, clamps page, and derives the selected item's page. Query selection is canonical on collection routes; path selection is canonical on object routes, row clicks replace that path, and unknown IDs render an explicit 404 with an absolute collection return target. | URL normalization, deep-link row selection, unknown-ID, and return-action tests |
| P2 offline notice covers content/header and is not announced | Offline notice is a semantic assertive alert at the reviewed 48px header boundary; the offline content wrapper reserves its 30px height. | Accessible offline-event test and executable non-overlap CSS test |
| P2 unclear hierarchy/desktop width | ProLayout remains the approved shell with mix/split hierarchy, 48px header token, 184px secondary Sider, explicit parent/leaf state, fluid content, and 1680px content ceiling. | ProLayout selection test and production build |
| P2 icon-only logout/text overflow | Logout has Tooltip and accessible name; header, list title/status/summary, context, IDs, and detail values have bounded truncation or stable wrapping. | Tooltip/accessible-name test and long-text tests at 320px and 360px |
| P2 direct status actions do not recover | 403/404 return to the workspace, session-expired login returns to `/workspace`, and 500/offline/maintenance refetch bootstrap before leaving the status URL. | Direct status action, login target, refetch, and actual-location tests |
| P2 lazy route rejection escapes Suspense | A synchronous Error Boundary contains rejected/stale route chunks, renders generic safe failure copy, and exposes an explicit full-page reload action. | Synthetic lazy-route failure and recovery-action test |
| P3 monolithic bundle/no budget | Overview, collection, settings, and status routes are distinct lazy entries; vendor groups use explicit-only manual chunks; build executes `check-bundle.mjs`. No Vite warning limit is raised or disabled. | Production build and manifest-driven bundle budget |

The Owner's earlier browser attempt had no available runtime and was not treated as a pass. The original independent Reviewer subsequently completed the required in-app Browser pass against exact commit `a11679c` at 1366x768 (`/workspace`), 1440x900 (`/tasks?tab=history`), 1920x1080 (`/resources` redirecting to `/forms`), and 390x844 (`/tasks`). All four viewports had `document.scrollWidth <= document.clientWidth`, no header/main/alert overlap, and correct narrow-screen vertical reflow.

## Required Verification

- `pnpm --filter @ai-crm/workbench-web build`
- `pnpm --filter @ai-crm/workbench-web lint`
- `pnpm --filter @ai-crm/workbench-web typecheck`
- `pnpm --filter @ai-crm/workbench-web test`
- `pnpm --filter @ai-crm/workbench-web contracts:check`
- `pnpm check` where the restored shared Lockfile allows it; any frozen-lock mismatch is owned by the serialized integration window.

## Verification Evidence

- Workbench build: passed; Vite production output generated successfully.
- Workbench lint: passed with the application-local TS/TSX typed ESLint configuration.
- Workbench typecheck: passed.
- Workbench tests: 3 files, 23 tests passed. Coverage includes longest-prefix shell selection, parent redirects, canonical object deep links, unknown-object handling, URL normalization, route-specific status actions and recovery, all required runtime states, fixed BFF login construction, logout pending/success/failure/retry, semantic connectivity announcements, lazy-route failure containment, Tooltip/accessibility, offline non-overlap, and 320px/360px long text behavior.
- Workbench contract/package check: passed.
- Repository boundary check: passed after removing the cross-package ESLint configuration import.
- Full `pnpm check`: passed after Round 1 remediation, 140/140 Turbo tasks successful.
- Production artifact scan: concrete development fixture identifiers and values are absent; the generic Fixture disclosure component remains intentionally available for injected non-production data.
- Independent visual browser pass: passed against exact commit `a11679c`. The Reviewer verified 1366x768 `/workspace`, 1440x900 `/tasks?tab=history`, 1920x1080 `/resources` to `/forms`, and 390x844 `/tasks`; all viewports had no horizontal overflow or header/main/alert overlap, with correct narrow-screen vertical reflow. `/coordination` redirected to `/tasks`. Direct 403, 500, offline, session-expired, and maintenance routes exposed the correct actions; the single 500 retry button recovered to `/workspace`. Browser console errors and warnings were both zero.
- Bundle budget: passed without changing `chunkSizeWarningLimit`. Entry is 87,240 bytes; manifest static-initial import closure is 976,796 bytes. Complete route import closures are collection 1,163,720 bytes, overview 1,049,729 bytes, settings 991,182 bytes, and status route 977,149 bytes. The largest individual chunk is 493,550 bytes; all four route entries are independently lazy.

## Review Status

- Owner self-review: Round 1 and follow-up fixes implemented; scoped diff, business-neutrality, failure-mode, accessibility-code, bundle graph, and full repository checks pass with no open Owner finding.
- Independent reviewer: Agent A completed same-reviewer code, accessibility, route, failure-mode, and in-app Browser review against exact commit `a11679c`; actionable findings are zero and unresolved architecture or contract issues are zero.
- G2 acceptance: ready for the Integration Owner to record; not self-declared by the CLI-01 Owner.
