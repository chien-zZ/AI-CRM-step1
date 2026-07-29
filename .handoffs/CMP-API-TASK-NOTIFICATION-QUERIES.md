# CMP API Task / Notification PostgreSQL Query Composition

- Status: IMPLEMENTED; production activation remains subject to runtime grants and real policy/identity evidence
- Owner: CMP-01 API production composition
- Allowed paths: `apps/api/**`, this handoff, directly related CMP documentation

## Known Facts

- Task Center and Notifications already expose reviewed PostgreSQL stores and application facades through package public entry points.
- Both facades require their own Authorization and management-Audit ports even when the outer HTTP operation has already been authorized.
- Notification reads are persisted and filtered by the current `principalId`. Task projections are not principal-scoped in storage; Task object visibility must be decided by an owning authorization adapter for every item.
- The Task/Notification actor contracts carry only `principalId`; they do not carry the current active Assignment set or selected Assignment.
- The current API registers no Task/Notification controllers. This slice composes query dependencies only and does not expose new routes.

## Allowed Assumptions

- A UUID `principalId` supplied by a future reviewed API adapter may be treated only as an explicit Workforce Person reference. The authorization adapter uses no Assignment IDs and therefore supports only an explicitly approved Workforce Person Grant.
- Store-level `list(limit: 1)` and `unreadCount` are non-writing, bounded capability probes that verify the module schema/table privilege without exposing returned content.
- Module management audit may deterministically derive operation IDs from the durable authorization decision and bounded module operation/reference while retaining the same safe Trace correlation.

## Forbidden Assumptions

- Do not infer Assignment, candidate scope, assignee ownership, recipient identity, or object visibility from names, Keycloak claims, stored display references, or Task/Notification content.
- Do not treat the outer HTTP permission, database reachability, or a list permission as Task object authorization.
- Do not enable Task completion/reconciliation/source routing or Notification intent/template/recipient/preference/mutation behavior without their reviewed production ports.
- Do not query Organization tables directly or add synthetic workforce/notification/task facts for readiness.

## Implemented

- Production composition creates PostgreSQL Task and Notification stores and their public facades.
- Notification list/detail/unread authorization maps to the reviewed `platform.notifications.in-app-notification:list|read` permissions. PostgreSQL still enforces current-principal ownership.
- Task list maps to `platform.task-center.task-projection:list`. Task detail/object authorization deliberately remains unavailable because no reviewed principal/Assignment/candidate rule exists; non-empty Task lists therefore fail closed during per-item authorization instead of leaking projections.
- Task router/source reader and Notification resolver/preference ports reject every call. Mutation methods are not exported by `ApiQueryBindings`.
- Attempted, succeeded and failed query facts append through the PostgreSQL Audit service. A missing Trace/decision association, invalid actor or Audit failure fails the module call.
- Required `task-query` and `notification-query` readiness dependencies run bounded, read-only module-store probes after database health. Probe failure or database loss clears readiness; recovery rechecks the real stores.

## Workflow Assessment

- `WorkflowEngine.health()` is a reviewed public provider-health method, but the API has no typed Flowable `*_FILE` configuration or Secret mount and no reviewed Workflow HTTP binding.
- Workflow mutations require a durable production `WorkflowCommandLedger` and lifecycle Outbox sink. Only the memory Ledger exists and is explicitly non-production.
- Consequently Workflow is not composed, no Workflow readiness claim is added, and no route is invented in this slice. Host-A Flowable service credentials do not authorize giving the API those credentials.

## Verification / Remaining External Work

- Focused API composition tests cover real Task/Notification store probes, successful audited empty-list queries under an explicit Workforce Person Grant, and Task object authorization failure.
- API test/typecheck/lint/build and `git diff --check` are the scoped gates.
- Production runtime SQL grants for Task/Notification API reads must be reviewed and versioned separately. A generic database probe does not replace them; absent grants keep the new readiness dependencies unavailable.
- Future Task HTTP composition needs a reviewed request context carrying current Workforce Person plus active/selected Assignment and an object-visibility rule. This slice does not weaken that gate.
