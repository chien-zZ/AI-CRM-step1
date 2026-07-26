# IAM-03 Explicit Authorization Core

- Status: review/fix loop complete; G2 accepted
- Owner: 当前会话
- Branch: `codex/IAM-03-authorization-core`
- Allowed paths: `packages/platform-modules/authorization`, `contracts/permissions`, the corresponding `packages/platform-sdk` entry, dependency manifests, tests, and directly related documentation

## Known Facts

- Authentication, internal workforce resolution, and business authorization are separate decisions.
- `authorization` owns permission declarations, role permission bundles, effective grants, checks, batch checks, structured data scopes, and stable deny semantics.
- Roles are configurable permission bundles and are not Position names, Keycloak Roles, or hard-coded conditions.
- Data scopes are versioned typed constraints interpreted by the resource-owning module; they are never SQL, ORM fragments, or business table names.
- Authorization defaults to deny when the permission, subject context, policy version, grant, scope, cache dependency, or decision recording cannot be trusted.

## Allowed Assumptions

- Permission codes, resource types, actions, role IDs, and scope dimensions use bounded namespaced identifiers; IAM-03 registers only synthetic test declarations.
- A policy snapshot is immutable and identified by a bounded opaque version. Its durable storage remains behind a vendor-neutral port because ADR-0007 leaves storage selection unconfirmed and the IAM-03 path ownership excludes database migrations.
- Effective grants target either one Workforce Person as an explicit controlled exception or one effective Assignment. An active Assignment grant is considered only when that Assignment is explicitly selected in the authorization context.
- Data Scope v1 is a normalized union of either explicit resource-wide access or conjunctive dimension/value matches. Every dimension must be declared by the resource Owner.
- Redis caches only validated evaluation material under SHA-256 keys that include policy version; TTL and namespace are explicit. A cache miss or failure recomputes from the authoritative policy snapshot and never grants by itself.
- Every returned decision receives a fresh UUID audit reference and is sent with stable Workforce Person, explicit Assignment when selected, and W3C Trace reference to a required decision-recorder port before a result can escape.

## Forbidden Assumptions

- Do not create sales, finance, administrator, manager, employee, or other real roles, permissions, resources, or data-scope values.
- Do not interpret Keycloak claims, Position text, names, department labels, frontend visibility, or invitation capabilities as grants.
- Do not generate SQL, ORM predicates, table/column names, arbitrary expressions, scripts, or executable policy text.
- Do not silently union all concurrent Assignments or select the first Assignment. Assignment-scoped grants require an explicit active Assignment selection.
- Do not query organization tables, domain tables, Keycloak, or provider systems from authorization.
- Do not treat Redis as the policy source of truth or allow on cache/store/recorder corruption.

## Non-goals

- No real company role matrix, management UI/API, approval flow or IAM administrator permission.
- No policy database migration is created while ADR-0007 explicitly leaves durable policy storage and publication unresolved; the port is not permission to invent a production schema.
- No Casbin, OpenFGA, OPA, Cerbos, Keycloak authorization service, Rego, relationship graph, or external policy runtime.
- No CRM resource declaration, object ownership rule, external invitation authorization, frontend component permission system, or domain query adapter.

## Required Tests

- Known permission allow, unknown permission deny, missing grant deny, invalid context deny, and stable server-side denial error.
- Batch results preserve single-check semantics and input order.
- Structured scope resolution and object-context matching never return SQL or silently ignore undeclared dimensions.
- Explicit switching between concurrent Assignments changes the applicable grants without unioning inactive context.
- Effective grant interval boundaries and Workforce Person controlled exceptions behave deterministically.
- Cache hit/miss/failure, policy-version isolation, and explicit version invalidation preserve authorization truth.
- Decision recording receives the minimum required audit facts; technical telemetry and Redis keys cannot leak Workforce Person, Assignment, scope values, or resource-object facts.
- `pnpm check` passes.

## Unresolved Questions

- Real resource/action declarations, role bundles, risk classification, grant administrators, approval routes, policy storage, retention, and policy publication workflow remain unconfirmed.
- Actual scope dimensions and each owning module's translation to local queries remain for that module's reviewed contract.
- Decision-record retention and which production low-risk allows may use sampled technical telemetry versus durable audit remain for audit/data-security review; IAM-03 records every decision through a required port.
- Redis production TTL, capacity, outage objectives, and invalidation delivery source remain operational configuration decisions.

## Separate Review Pass

- Authorization: implementer review complete. Unknown permissions and incomplete/extra context deny; Assignment grants require one explicitly selected active Assignment; Workforce Person grants remain explicit controlled exceptions; no Keycloak Role, Position text, frontend state, or real business role is interpreted as authority.
- Idempotency and versioning: reviewed. Checks do not mutate business state, each decision receives a fresh validated UUID, immutable policy snapshots are versioned, and batch order preserves single-check semantics.
- Transactions and caching: reviewed. No database transaction is introduced. Redis is non-authoritative, digest-keyed, TTL-bounded, isolated by policy version, compared with fresh evaluation, and safe to bypass on errors. Its multi-command index is cleanup-only and cannot expand access.
- Migrations: implementer review complete. No authorization database schema or Drizzle migration is created because accepted ADR-0007 leaves durable Policy Store and publication selection unresolved. This is an explicit non-applicable migration item, not automatic schema synchronization.
- Observability and audit: implementer review complete. The required recorder blocks result escape on failure. Decision audit intents include Workforce Person, explicit Assignment, decision ID and Trace ID; bounded technical telemetry excludes those identity facts, scope values, object facts, Token/Cookie/Secret material and request bodies.
- Backward compatibility: reviewed. Public package changes are additive; formal schemas are new version `1.0.0` contracts, and the SDK exposes only the stable authorization capability surface.

## Implementation Evidence

- Formal contracts: `data-scope.v1.schema.json`, `authorization-policy.v1.schema.json`, and `authorization-decision.v1.schema.json`.
- Runtime: validated policy snapshots, Check, Batch Check, Data Scope Resolution, denial/unavailable errors, required decision recording, bounded telemetry, and optional Redis cache adapter.
- SDK: `createPlatformAuthorizationClient` exposes Check, Batch Check, Data Scope Resolution, and `requireAllowed` without policy-store or Redis access. `requireAllowed` performs its own server-side decision and cannot accept a caller-fabricated allow result.
- Tests: 20 authorization tests cover allow/deny, unknown permission, context validation, Assignment switching, Workforce Person exception, effective boundaries, scope resolution, cache corruption/failure/versioning, recorder failure, audit correlation, provider failure mapping and contract-valid uppercase UUID normalization; 2 SDK tests cover the public capability boundary.
- Runtime integration: 1 local Redis test verifies authenticated connect, set/get, TTL, digest-only identity-safe keys, version invalidation, and cleanup. Local Compose reported all seven services healthy.
- Targeted gates: frozen install, Authorization and SDK typecheck/lint/test/build, `pnpm contracts:generate`, `pnpm contracts:check`, real Redis integration and `git diff --check` passed on 2026-07-26.
- Full gate: `pnpm check` passed on 2026-07-26 with 140/140 Turbo tasks successful across 28 Workspace packages.

## 2026-07-26 Review/Fix Loop

- Round 1 found that `assertAllowed(decision)` trusted a caller-provided decision and could be invoked with a fabricated allow object. It was replaced by `requireAllowed(subject, request)`, which evaluates and records the decision internally before returning or throwing the stable denial.
- Round 1 also aligned contract-valid UUID handling by accepting case-insensitive input and normalizing Workforce Person, Assignment, Role and Grant identifiers before comparison. Clock and decision-ID provider exceptions now fail closed through stable behavior.
- Round 2 corrected Clock failure classification from request `invalid_context` to infrastructure `policy_unavailable`, and ensured Redis clients are destroyed when connect or graceful shutdown fails.
- Round 3 rechecked authorization, idempotency/versioning, transactions, migrations, observability/audit, Secrets, public boundaries and backward compatibility. No new findings remained.
- The project owner requested this review/fix loop continue until clean and then merge. With the final no-finding pass and full gate evidence, IAM-03 is accepted through G2.
- Final post-loop gate: `pnpm check` passed with 140/140 Turbo tasks after all review fixes.
