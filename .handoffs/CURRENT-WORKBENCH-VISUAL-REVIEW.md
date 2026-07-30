# Current Workbench Visual Review

- Review date: 2026-07-30
- Candidate base: `d305486`
- Scope: current `apps/workbench-web` business-neutral development fixture
- Result: repository-level visual verification passed; this is not production or cross-component E2E evidence

## Task Boundary

Known facts:

- The PC workbench remains a business-neutral shell using synthetic development data.
- Acceptance items 14-07 and 14-08 previously relied on a historical browser pass at `a11679c`.
- The current review ran the Vite development fixture from the current candidate tree.

Allowed assumptions:

- A local in-app browser render can prove the current client tree has no viewport regression in the reviewed routes.
- Synthetic labels and identifiers may be used only as development evidence.

Forbidden assumptions:

- This review does not prove production BFF, Keycloak, authorization, external clients, real user data, deployment, or monitoring.
- Client visibility and navigation do not replace server-side authorization.

Non-goals:

- No UI redesign, CRM page, business metric, role, workflow, provider integration, contract, or production configuration was introduced.
- No production or external system was accessed.

## Fresh Browser Evidence

The following routes were rendered after both session restoration and lazy-route loading completed:

| Viewport | Route | Observed canonical route | Result |
|---|---|---|---|
| 1366x768 | `/workspace` | `/workspace` | No horizontal overflow; header, main and Fixture alert do not overlap. |
| 1440x900 | `/tasks?tab=history` | `/tasks?tab=history&filter=all&page=1&selected=fixture-task-06` | History state restored; master-detail content rendered without horizontal overflow or overlap. |
| 1920x1080 | `/resources` | `/forms?tab=active&filter=all&page=1&selected=fixture-form-01` | Stable parent redirect and form master-detail render passed without horizontal overflow or overlap. |
| 390x844 | `/tasks` | `/tasks?tab=active&filter=all&page=1&selected=fixture-task-01` | Narrow layout reflowed vertically; client and document scroll widths both remained 375 CSS pixels. |

For all four viewports:

- `document.scrollWidth <= document.clientWidth`.
- The fixed banner bottom did not cross the main-content top.
- The Fixture alert remained within the main-content bounds.
- Browser page console warnings and errors were both zero.

Direct status routes exposed the reviewed recovery actions:

- `/status/403`: `返回工作概览` to `/workspace`.
- `/status/500`: the unique `重试` action recovered to `/workspace`.
- `/status/offline`: `重试`.
- `/status/session-expired`: `重新登录` to `/auth/pc/login?returnTo=%2Fworkspace`.
- `/status/maintenance`: `重试`.

The browser viewport override was reset and the review tab was released after verification.

## Review Conclusion

No current-tree visual, responsive-layout, route-restoration, status-recovery, or page-console finding was observed in the reviewed scope. This evidence supports repository-level closure of acceptance items 14-07 and 14-08 only; it does not unlock E2E-01 or change G3 external evidence requirements.
