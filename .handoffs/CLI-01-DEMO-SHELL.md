# CLI-01 Demo Shell Preview

## Objective

Rebuild the existing Demo workbench shell on Vite so the project owner can review the primary navigation and visual framework.

## Known Facts

- The current user request explicitly asks to reuse the Demo frontend appearance, especially the primary navigation and shell.
- Umi must not be used; the shell must be rebuilt with Vite.
- `apps/workbench-web` previously contained only a package placeholder.

## Allowed Assumptions

- Demo navigation labels and synthetic counts may be shown for visual review only.
- React Router replaces Umi history and route state.
- Static synthetic page data is acceptable for this visual preview.

## Forbidden Assumptions

- Demo state, permissions, roles, SLA values, Action Engine, Mock Store, or localStorage persistence are not formal production rules.
- Frontend visibility is not server authorization.

## Non-goals

- No backend integration, authentication, provider integration, domain persistence, or production CRM workflow.
- No Umi Max, Umi Model, Demo Action Engine, or AI assistant.

## Authority And References

- Current user request.
- `D:\CRM-demo-Ant-design\myapp\src\dept3\layouts\Dept3Layout.tsx`.
- `docs/04-工程手册/PC工作台Demo参考基线.md` (overridden only where the current user explicitly requested direct visual reuse).

## Allowed Paths

- `apps/workbench-web`.
- `.handoffs/CLI-01-DEMO-SHELL.md`.
- Root lockfile as required for the package dependency graph.

## Forbidden Paths

- Contracts, database schemas, platform modules, domain modules, API, worker, deployment, and provider adapters.

## Contract Changes

None.

## Migration Changes

None.

## Dependencies

React 19, Vite, Ant Design 6, ProComponents, React Router, and TanStack Query.

## Required Tests

- Navigation longest-prefix matching.
- Workbench package build, lint, typecheck, test, and repository checks.

## Authorization And Audit

Not implemented in this visual preview. Production routes and commands must consume reviewed authorization contracts and server enforcement.

## Idempotency, Retry And Failure

No write commands exist in this preview.

## Observability And Health

Not applicable to the static visual preview; production runtime work remains pending.

## Backward Compatibility

The package public `applicationId` export remains unchanged.

## Deliverables

- Runnable Vite workbench.
- Demo-derived two-column navigation and 48px top bar.
- Compact workbench homepage and placeholder navigation pages.

## Unresolved Questions

- Whether all Demo business navigation labels should remain in the production application registry.
- Whether the exact custom two-column shell replaces the previously accepted ProLayout requirement.
- Which Demo themes, assistant, role switcher, and business pages are approved for later migration.

## Handoff Result

Implemented a Vite and React Router reconstruction of the Demo shell without Umi. The preview includes the two-column navigation, independent collapse controls, 48px top bar, breadcrumb, context selector, global actions, compact statistics, todo list, activity timeline, and placeholder pages for navigation validation.

Verification completed:

- Workbench build, lint, typecheck, test, and package contract check passed.
- Navigation matching tests passed (2 tests).
- Browser validation passed at 1440x900 with no horizontal overflow.
- Primary navigation collapses to 56px and route selection updates both navigation levels.
- Ant Design 6 deprecation warnings introduced during the first preview were removed; no new warnings appeared after reload.
- Full `pnpm check` passed (140/140 Turbo tasks). The first run had a transient pre-existing observability smoke-test timeout under full parallel load; the isolated rerun and cached full rerun both passed.

Known follow-up:

- The current initial JavaScript chunk is approximately 917 KB before gzip (296 KB gzip). Route-level code splitting should be added as real pages are introduced.
- Demo business labels and synthetic values remain presentation-only and require explicit confirmation before becoming production application-registry or domain facts.
