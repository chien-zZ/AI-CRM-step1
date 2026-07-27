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
- Bundle-gate regression tests: 5 Node tests passed, covering hashed entrypoint discovery, exact HTML attribute matching, canonical asset deduplication, external/traversal rejection, missing assets, and budget overflow.
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

## Post-G2 Integration Regression

- Integration verification reopened CLI-02 after a clean Lockfile/full `node_modules` rebuild produced `js/395.js` instead of the previously observed `js/512.js`; the hard-coded bundle gate failed with `ENOENT` even though the Taro build itself was valid.
- Fix: the bundle gate now derives initial JavaScript and stylesheet assets from production `dist/h5/index.html`, deduplicates references, resolves them within the real output root, and rejects external origins, traversal/backslashes, invalid URL encoding, symlink escape, missing assets, absent JS/CSS entrypoints, source maps, forbidden content, and totals above the unchanged 600 KiB budget.
- Verification: 5 bundle-gate tests, 27 Vitest tests, lint, typecheck, production build, package contract check, repository check, `git diff --check`, and `pnpm check` (140/140) pass. Lockfile remains unchanged.
- Review status: Integration P1 fix is pending independent re-review by the original Agent A. Previous G2 acceptance is reopened until that review reports zero actionable findings and Integration verification passes on the serialized Lockfile environment.
- Integration follow-up: the serialized main-worktree install currently reports a Taro plugin peer warning (`vite@^4` expected while `vite@7` is present). The approved H5 build uses the Webpack runner and this warning is not changed or waived by CLI-02. Integration Owner must evaluate it in the shared dependency/Lockfile window; this task must not add Vite dependencies or modify the Lockfile speculatively.
- Integration Re-review Round 1 on candidate `2f11a02`: Agent A closed the original hard-coded-chunk P1 direction but reported one P1 fail-open attribute match (`data-src`/`data-rel`/`data-href`) and one P2 duplicate budget count for URL aliases resolving to the same real file; no other implementation or architecture/contract issue was found.
- Round 1 fixes: HTML attributes now require an exact whitespace-delimited attribute token, so prefixed lookalikes cannot become entrypoints; safely resolved assets are deduplicated by canonical real path before stat and budget summation. Regression tests prove lookalikes fail closed and `/js/app.js`, `js/app.js`, and `/js/app.js?v=1` count the same file once.
- Integration Re-review Round 2 on exact candidate `cac70c49328c636f69d3929b6925dc7881047533`: Agent A confirmed both findings closed, found no new actionable finding, and reported zero unresolved architecture/contract issues after rerunning 5 Node tests, 27 Vitest tests, the production build/bundle gate (`540927/614400`), and diff-check. CLI-02 is eligible for G2 restoration subject to Integration Owner confirmation in the serialized shared dependency environment; the recorded Taro peer warning remains a separate Integration Owner follow-up.

## Post-G2 Clean-install React Type Regression

- Clean shared dependency validation reopened CLI-02 because NutUI JSX declarations resolved `ReactNode` through `@types/react@19.2.2` while Internal Mobile intentionally uses React and `@types/react` 18. The mismatch produced TS2786 errors for the NutUI components even though NutUI supports React 18 at runtime.
- Root cause: the current Lockfile resolves the wildcard React type dependency of `@types/react-dom@18.3.0` to React types 19 in pnpm's virtual store. NutUI has no private React type dependency, so realpath-based declaration resolution can bind to that transitive React 19 copy.
- Rejected workaround: `preserveSymlinks` removes the NutUI TS2786 errors but makes `@testing-library/react` unable to resolve its transitive `@testing-library/dom` re-exports under the pnpm symlink layout. CLI-02 does not enable it or hide the mismatch with broader compiler suppression.
- Fix: `src/nutui-adapter.ts` is an application-owned compatibility boundary. Runtime components still come directly from NutUI, while the adapter exposes only the React 18 props used by this application so React 19 declaration types cannot leak into application JSX. Status-page mocks cover every eagerly imported adapter component.
- Review status: G2 remains withdrawn. This fix requires clean offline frozen-Lockfile validation from the current main baseline followed by independent re-review by the original Agent A. No root dependency, shared configuration, Lockfile, or Vite/Taro dependency change is included.
- Independent React-type Review Round 1 on candidate `5241a789`: Agent A reported one P2 because the adapter exposed `NoticeBar.content` as `ReactNode` while the NutUI contract requires `string`; both test mocks repeated the overly broad type. No other actionable or unresolved architecture/contract issue was found.
- Round 1 fix: `NoticeBar.content` and both mocks are now string-only. A compile-time negative case uses `@ts-expect-error` to prove arbitrary JSX content remains rejected while string content remains accepted.
- Independent React-type Review Round 2 on exact candidate `744457026b8c4f5594429c56440dc43785b32d6d`: Agent A confirmed the P2 closed, found zero new actionable findings and zero unresolved architecture/contract issues, and verified the negative type constraint would fail if the boundary widened again. Integration Owner merged the increment and passed clean shared/frozen typecheck, 5 Node tests, 27 Vitest tests, production bundle gate (`540942/614400`), and full `pnpm check` (140/140).
- G2 restoration: accepted after the original Reviewer reported zero actionable findings and the Integration Owner completed clean shared dependency validation. The Taro/Vite peer warning remains a separately recorded Integration Owner dependency-window follow-up and is not waived by this acceptance.

## Post-G2 Taro Config Declaration Regression

- CLI-03 shared dependency validation reopened CLI-02 because declaration inference for `src/app.config.ts` and all `src/pages/*/index.config.ts` default exports produced TS2742 references into pnpm's private virtual-store path for `@tarojs/taro`.
- Root cause: the global `defineAppConfig` / `definePageConfig` return types were exported through inference. Their inferred declaration identity depended on the concrete pnpm dependency graph instead of an explicit public package boundary.
- Fix: app and page config values now have the narrow public `Taro.AppConfig` / `Taro.PageConfig` annotations imported from `@tarojs/taro`. No vendor DTO is copied, and no compiler strictness, declaration output, or library checking is disabled.
- Regression coverage: `scripts/declaration-portability.test.mjs` runs a real declaration-only TypeScript build in a temporary directory, requires all six config declarations to import only the public `@tarojs/taro` entry point, and rejects `.pnpm`, `node_modules`, or absolute Windows paths.
- Verification: scoped typecheck, lint, and package contract checks passed; 6 Node tests including declaration portability passed; 27 Vitest tests passed; production H5 build and bundle gate passed at `540927/614400` bytes; `git diff --check` passed.
- Owner self-review: zero actionable findings remain in the task boundary. The fix changes declaration typing only, adds no runtime behavior, authority, persistence, migration, telemetry, Secret handling, or failure-mode semantics, and preserves the existing public Taro config values.
- Review status: G2 is reopened for this cross-line regression. The exact candidate requires independent re-review by Agent A, followed by Integration Owner validation in the CLI-03 shared dependency environment and a full repository check. Lockfile and all non-CLI-02 paths remain unchanged.
- Independent Review on exact candidate `a2ef48eeae6959f5062aa26aa775c72397906ff5`: Agent A reported zero actionable findings and zero unresolved architecture/contract issues. The Reviewer confirmed all six config declarations use the public Taro type boundary, runtime imports are erased, runtime values/build behavior are unchanged, and the regression fails closed when declaration emission or portability checks fail.
- Reviewer verification: typecheck, lint, 6/6 Node tests, 27/27 Vitest tests, production H5 build/bundle gate (`540927/614400`), package contract check, and diff-check all passed. Authorization, idempotency, transactions, migrations, and observability are not applicable because runtime behavior is unchanged; backward compatibility, Secrets, failure modes, and portability passed.
- Current status: independent Review is closed with finding zero. G2 restoration remains pending only the Integration Owner's CLI-03 shared dependency graph and full repository validation; it is not self-declared by CLI-02.

## Declaration Fix Integration Acceptance

- Integration Owner merged the reviewed declaration fix as `3a853c0` and rebuilt the shared dependency graph with CLI-03 present.
- Clean offline frozen install passed. CLI-02 Node tests passed `6/6`, Vitest passed `27/27`, production H5 build passed, and the bundle gate reported `540932/614400` bytes in the final full-repository run.
- Final `pnpm check` passed `140/140`. The reviewed fix adds no runtime behavior or authority and has zero remaining actionable finding or unresolved architecture/contract issue.
- G2 restoration is accepted. The existing Taro/Vite peer warning remains a separately recorded shared dependency follow-up and is not waived by this acceptance.
