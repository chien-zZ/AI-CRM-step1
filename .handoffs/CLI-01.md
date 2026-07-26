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
- BFF login entry and a fail-closed production runtime port. Development-only/test-only fixture content is visibly labelled synthetic.
- Master-detail platform collection layout, keyboard-focus treatment, accessible labels, empty states, and responsive behavior.

## Demo Reference Differences

- Uses ProLayout `mix`/split navigation instead of copying the Demo's custom dual Sider implementation.
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
- Failure Modes: loading, fetch failure, signed-out, expired, maintenance, offline, forbidden, missing route, and retry behaviors are explicit.

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
- Workbench tests: 2 files, 7 tests passed. Coverage includes longest-prefix routing, URL state recovery, all required runtime states, fail-closed maintenance, and BFF login entry.
- Workbench contract/package check: passed.
- Repository boundary check: passed after removing the cross-package ESLint configuration import.
- Full `pnpm check`: passed, 140/140 Turbo tasks successful.
- Production artifact scan: concrete development fixture identifiers and values are absent; the generic Fixture disclosure component remains intentionally available for injected non-production data.
- Visual browser pass: not executed because no in-app browser instance was available in the current environment. Independent visual review remains required.
- Build observation: initial JavaScript is about 1,163 KB minified / 379 KB gzip and Vite reports a chunk-size warning. Do not suppress the warning; profile ProLayout/Ant Design splitting during the integration performance pass.

## Review Status

- Owner self-review: complete with no open correctness, boundary, authorization, business-neutrality, accessibility-code, or failure-mode finding. Bundle size and browser visual verification are recorded above as follow-up evidence items.
- Independent reviewer: Agent A, not yet started.
- G2 acceptance: not claimed.
