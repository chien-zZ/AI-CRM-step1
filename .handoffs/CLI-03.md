# CLI-03 Handoff

## Task

Deliver the independently buildable External Portal Taro shell for H5 and WeChat Mini Program without inventing an external business scenario or widening the approved external API surface.

## Ownership

- Owner: Agent C
- Independent Reviewer: Agent A
- Branch: `task/CLI-03-external-portal`
- Worktree: `D:\AI-CRM-worktrees\CLI-03`
- Allowed paths: `apps/external-portal/**`, proven necessary external-client allowlist consumption configuration, and this handoff.
- Shared resources: Integration Owner exclusively owns `pnpm-lock.yaml`, root configuration, generated contracts/clients, `apps/api`, and `apps/worker`.

## Known Facts

- ADR-0016 requires one independent Taro application to produce H5 and `weapp` artifacts with React, TypeScript, and NutUI React.
- External H5 uses an isolated BFF HttpOnly Cookie. Client JavaScript must not read or store that Cookie or any Keycloak token.
- A WeChat Mini Program may hold only a short-lived, revocable, opaque server-session handle. It must never receive Keycloak tokens, provider secrets, or the WeChat `session_key`.
- The External Portal may consume only `@ai-crm/api-client/external`; hiding internal operations in UI is not a security boundary.
- `contracts/generated/external.openapi.json` currently has no paths and `packages/api-client/src/external.ts` currently exports an empty `externalOperations` allowlist.
- No concrete external subject, anonymous operation, invitation flow, authenticated business operation, provider login, or account lifecycle is confirmed.

## Allowed Assumptions

- H5 and `weapp` can share business-neutral page semantics while platform-specific transport, session, navigation, file, connectivity, and lifecycle behavior stays behind adapters.
- Development and tests may use clearly marked synthetic fixture states that are unreachable from production runtime composition.
- The shell may present loading, empty, unavailable, denied, session-expired, offline, and contract-pending states without claiming a concrete access mode was selected.
- Public non-secret build metadata and stable, minimal error categories may be displayed.

## Forbidden Assumptions

- Do not create an anonymous endpoint, invitation token/table/model, generic external user, account association, role, permission, CRM entity, field, SLA, approval route, Provider, Prompt, or real person fixture.
- Do not treat anonymous, restricted-invitation, or authenticated access as enabled. A future owning domain must select and contract one mode per operation.
- Do not import the internal API client, copy DTOs, embed internal routes/operation IDs, or infer server operations from documentation.
- Do not implement real WeChat login, `code2session`, Keycloak callback handling, provider identity linking, or production session issuance.
- Do not store credentials in URLs, logs, page state, persistent UI snapshots, or production fixtures.

## Non-goals

- No backend endpoint, API/Worker composition, contract source, generated artifact, Lockfile, shared UI, database, migration, or deployment change.
- No real external workflow, form, upload, identity, invitation, notification, task, or CRM page.
- No claim that browser or local component tests replace real WeChat Developer Tools, device, privacy-review, domain-allowlist, or release-signing validation.

## Design and Failure Boundaries

- Production bootstrap fails closed to a contract-pending/empty shell while the external operation allowlist is empty.
- External transport validates operation ID/method/path against the generated external allowlist before I/O. With the current empty allowlist, every operation is rejected locally.
- H5 transport uses same-origin Cookie credentials and never reads the Cookie. Weapp transport may add only an injected opaque handle through its session port.
- Platform adapters expose stable results for cancellation, offline state, unavailable dependencies, session expiry, and unsupported capabilities.
- URL state is normalized to approved shell sections/statuses; arbitrary redirects and internal routes are not accepted.

## Review Matrix

- Authorization: frontend state never grants access; empty allowlist and unconfirmed access modes fail closed; server authorization remains authoritative.
- Idempotency: no business write is implemented; repeated bootstrap/navigation/session-clear and rejected transport behavior must be deterministic and side-effect bounded.
- Transactions: not applicable; the client owns no durable business facts or cross-resource transaction.
- Migrations: not applicable; no database or schema change is permitted.
- Observability: client-visible errors are stable and minimal; credentials, external identifiers, request bodies, and user content are not logged or bundled.
- Backward Compatibility: existing `applicationId` remains exported; new shell/adapters are additive and external-client-only.
- Secrets: no Cookie value, opaque handle fixture, Keycloak token, provider secret, `session_key`, private key, or source map may enter production artifacts.
- Failure Modes: loading, empty, denied, session-expired, offline, unavailable, unsupported target capability, duplicate attempts, stale async completion, and recovery are explicit.

## Open Items

- Resolved: Integration Owner merged the task, reconciled `pnpm-lock.yaml`, and completed clean offline frozen validation.
- Real WeChat Developer Tools automation, app account, domain allowlist, privacy declaration, signing/upload, and device smoke require external environment ownership and remain acceptance evidence outside this source-only task.
- The shared Taro framework-react peer warning (`vite@^4` expected while the workspace also contains Vite 7) is owned by the Integration dependency window. Both external targets use the approved Webpack runner; CLI-03 does not add or alter Vite speculatively.

## Verification Evidence

- Scoped typecheck: `pnpm --filter @ai-crm/external-portal typecheck` passed.
- Scoped lint: `pnpm --filter @ai-crm/external-portal lint` passed with zero warnings.
- Tests: Node artifact/declaration tests passed `4/4`; Vitest component/unit tests passed `17/17`.
- Contract guard: `pnpm --filter @ai-crm/external-portal contracts:check` passed.
- Target builds: production H5 and `weapp` builds passed using the approved Webpack runner.
- Artifact gate: final shared-run H5 initial assets `543010/665600` bytes; `weapp` total `596220/2097152` bytes.
- Repository boundary guard passed after the reviewed shared GOV-01 fix that permits only manifest-exported workspace subpaths; CLI-03 consumes only `@ai-crm/api-client/external`.
- Patch hygiene: `git diff --check` passed; `.swc/`, `dist/`, coverage, source maps, fixtures, secrets, internal API references, and unsupported WeChat private capabilities are rejected or excluded by artifact tests.
- Full repository gate: the latest `pnpm check` reached `133/140` successful tasks, then failed in the cross-owner `@ai-crm/internal-mobile#typecheck` task with TS2742 in Taro config default exports. CLI-03 tasks in that run passed; Turbo stopped remaining parallel work after the unrelated failure. Integration Owner/CLI-02 Owner has been notified. A clean full `pnpm check` remains required before G2 acceptance.

## Owner Self-review Round 1

- Authorization: no shell state grants resource access; current empty external allowlist rejects every operation before network I/O. Anonymous, invitation, and authenticated access modes remain disabled.
- Idempotency: repeated local rejection, session clear, bootstrap merge, and recovery paths are covered; no business mutation exists.
- Transactions: not applicable because the application persists no business fact and implements no multi-resource write.
- Migrations: not applicable; no database files or schemas changed.
- Observability: stable local error categories contain no resource identifiers, bodies, credentials, provider payloads, or user-controlled telemetry labels.
- Backward Compatibility: the existing public `applicationId` export remains; additions are application-local and use only the generated client's exported external entry point.
- Secrets: no Cookie value, token, opaque-handle fixture, `session_key`, provider secret, source map, or production development fixture is present in build artifacts.
- Failure Modes: denied, expired, offline, unavailable, contract-pending, stale completion, duplicate attempts, URL normalization, and offline-to-online recovery have explicit tests.
- Target boundaries: H5 uses same-origin Cookie credentials without reading the Cookie; `weapp` exposes only an injected opaque-handle port and does not invent a header or provider protocol.
- Finding result: zero owner-executable findings remain inside the CLI-03 path. Full repository validation is blocked by the recorded cross-owner CLI-02 issue, not waived.

## Review Status

- Status: READY FOR INTEGRATION. The shared CLI-02 declaration failure has been fixed and validated on `main`; CLI-03's corresponding declaration boundary and offline bootstrap behavior are also closed below.
- G2 must not be self-declared. Clean shared dependency validation and final Integration Owner evidence will be appended after the branch is merged.

## Integration Review Round 1

- Finding P2: CLI-03's app and page config default exports still relied on inferred `defineAppConfig` / `definePageConfig` declaration identities. A declaration-only consumer could therefore reproduce the pnpm private-path TS2742 regression found in CLI-02 even though ordinary no-emit typecheck passed.
- Fix: all three config exports now use explicit public `Taro.AppConfig` / `Taro.PageConfig` annotations. A real declaration-only Node regression test checks the emitted declarations and rejects `.pnpm`, `node_modules`, or absolute Windows paths.
- Finding P2: the shell called `bootstrap()` before initial connectivity was known. An initially offline client could perform unnecessary I/O, and recovery could reveal a result obtained before the current online/re-authorization boundary.
- Fix: bootstrap is now gated on confirmed online state. Going offline invalidates pending work and returns to a loading baseline; recovery performs a fresh bootstrap. The component test proves zero bootstrap calls while offline and exactly one fresh call after recovery.
- Review matrix result after fixes: authorization remains server-authoritative and fail-closed; rejected operations perform no I/O; there are no writes, transactions, migrations, telemetry payloads, secrets, or persistent domain facts; H5/weapp session types remain disjoint; stale async completion and recovery are covered.
- Tooling note: the configured `open-code-review` CLI was present but had no LLM endpoint configured. No credential was inferred or added. The Integration review therefore used local diff inspection and executable regression evidence and is not represented as an external independent-review result.
- Post-fix scoped evidence: Node tests `4/4`, Vitest tests `17/17`, typecheck, lint, and `git diff --check` passed. Dual-target production builds and final full-repository evidence remain Integration Owner merge-gate work.

## Integration Acceptance

- Task implementation commit: `7f8c4a7`; dependency candidate: `cdaccfd`; main merge: `87666f6`.
- Clean offline frozen install passed with all 29 workspace projects and no Lockfile drift.
- Production H5 and `weapp` builds passed in both the scoped build and the final Turbo run. The artifact gate reported H5 `543010/665600` bytes and `weapp` `596220/2097152` bytes; source maps, production Fixture markers, internal API client imports, credential patterns, and unapproved WeChat private capabilities were absent.
- Final full repository gate passed `140/140`. Node tests passed `4/4`, Vitest passed `17/17`, and package lint, typecheck, contract guard, repository boundaries, generated-contract determinism, and Compose checks passed.
- Integration finding status is zero. No contract, schema, migration, backend, domain, identity-provider, anonymous-operation, invitation, or external-user model was added.
- Status: MERGED. G2 remains pending only the governance-required independent Reviewer evidence; `open-code-review` could not supply it because no LLM endpoint was configured, and no credential was inferred or added. This process gap is not presented as a code finding or waived acceptance.

## Independent Review Loop

### Round 1

- Finding P2 (`apps/external-portal/scripts/check-artifacts.mjs`): the external-client source guard matched only `from "..."` imports. Side-effect imports, re-exports, dynamic imports, and CommonJS-style loads could bypass this source check; the repository boundary guard cannot close the gap because the public package root `@ai-crm/api-client` is a valid workspace export that contains internal operations.
- Fix: module references are now extracted with the TypeScript AST from static imports, re-exports, import-equals declarations, dynamic imports, and `require()` calls. Every `@ai-crm/api-client` reference except the explicit `/external` export fails before artifact acceptance.
- Regression: the Node artifact suite rejects named internal imports, package-root side-effect imports, package-root re-exports, dynamic imports, and `require()` loads.

### Round 2

- Authorization: the empty generated external allowlist remains the only callable surface; unknown and internal operations still reject before I/O. The fix narrows build acceptance and grants no runtime access.
- Idempotency: no business write exists; repeated rejected transport and artifact checks remain deterministic.
- Transactions and migrations: not applicable; no durable state, schema, contract, or migration changed.
- Observability and secrets: the guard emits only the owning source path and a stable category; it does not log source content, credentials, request bodies, external identifiers, or provider data.
- Backward compatibility: approved `@ai-crm/api-client/external` imports remain valid. The change affects only previously forbidden import forms.
- Failure modes: unsupported module forms now fail closed at the artifact gate. H5/weapp session isolation, offline recovery, stale completion, and production fixture exclusion remain unchanged and covered.
- Re-review result: zero High or Medium findings remain. No unresolved architecture or contract assumption was encoded.
- Tooling note: `ocr llm test` still reports no configured LLM endpoint. No credential was inferred or added; the independent review used direct diff inspection, repository rules, and executable regression evidence.

### Final Evidence

- Node tests `4/4` and Vitest tests `17/17` passed.
- Scoped typecheck, lint, contracts check, and `git diff --check` passed.
- Production H5 and `weapp` builds passed; artifact budgets remained H5 `543010/665600` and weapp `596220/2097152` bytes.
- Full repository `pnpm check` passed `140/140`.
- Independent Review status: PASSED. CLI-03 has zero actionable findings and satisfies G2 review evidence.
