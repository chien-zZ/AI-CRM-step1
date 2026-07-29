# Authorization

Owns a small, explicit, transport-neutral authorization core. Its public surface covers single checks, batch checks, and structured data-scope resolution. The first stage does not require Casbin, OpenFGA, OPA, or Cerbos; future engines remain behind adapters so domain modules never depend directly on a vendor.

Authentication success and Keycloak claims are inputs, not final business authorization decisions. This module remains authoritative for resource actions and future data-scope decisions. See [ADR-0004](../../../docs/08-架构决策/ADR-0004-Keycloak统一身份认证中心.md).

Function permissions and data scopes are separate. Data scopes are typed constraints rather than SQL fragments; the module that owns the data translates them into local queries and fails closed when it cannot enforce a constraint. Roles are configurable permission bundles and must not be hard-coded as authorization conditions.

Organization-derived grants should use effective assignments or explicit controlled exceptions rather than permanent grants inferred from a person's name or position text. Authorization consumes organization contracts and never queries organization tables.

External access distinguishes anonymous requests, restricted invitation capabilities, and authenticated Keycloak subjects. An invitation capability is not an identity and is never unioned with login permissions; see [ADR-0019](../../../docs/08-架构决策/ADR-0019-外部端分级访问与邀请授权.md).

## Usage Boundaries

- Use `check` when authorizing one concrete resource operation. A scoped permission requires a complete `resourceContext`; missing, undeclared, or extra dimensions fail closed.
- Use `requireAllowed` for server-side Guard/Facade enforcement. It evaluates the request internally and throws a stable denial carrying only the decision reference; callers cannot supply a fabricated decision object.
- Use `resolveDataScope` only to obtain structured constraints for a resource-owning repository. It rejects object context and never emits SQL, Prisma filters, table names, or executable expressions.
- Use `batchCheck` for bounded independent checks. It preserves input order and the semantics of individual checks.
- An Assignment grant applies only when callers explicitly select that active Assignment. Concurrent Assignments are never silently unioned. Person grants are explicit controlled exceptions, not inferred defaults.
- Every result must pass through the required decision recorder. Recorder failure makes authorization unavailable, including when the policy evaluation would otherwise allow.
- Decision audit intents include the stable Workforce Person, explicit Assignment when selected, decision ID, and W3C Trace ID. These are audit facts, not technical log or metric fields; bounded telemetry continues to exclude identity and resource-context values.

## Cache And Policy Store

Redis is an optional performance adapter, not an authorization fact source. Every operation loads and validates the authoritative immutable policy snapshot and computes a fresh result. Cached material is accepted only when it exactly matches that result; Redis failures or corrupted values cannot expand access. Policy-version keys isolate publication changes, and explicit invalidation is cleanup rather than a correctness dependency.

`connectRedisAuthorizationCache` requires an explicit namespace, bounded TTL configuration in the engine, password supplied by the composing application, and `rediss://` by default. Plain `redis://` requires the explicit development-only flag. Cache connection failure disables that adapter at composition time; runtime cache errors fall back to fresh policy evaluation.

ADR-0025 now defines the durable boundary. `createPostgresAuthorizationPersistence` supplies the production policy store, transactional publisher, and decision recorder through the public vendor-neutral `AuthorizationPersistenceRuntime`; no PostgreSQL client, Drizzle schema, query builder, or transaction handle is exposed. Publication accepts only a complete, contract-valid, non-empty snapshot and atomically writes an immutable version, an append-only publication fact, and the current pointer. Publication IDs and decision IDs support identical replay while conflicting reuse fails closed.

Migration `0000000012_authorization_policy_persistence.sql` is additive and intentionally seeds no policy. Apply it only through the reviewed deployment migration runner; application startup must never synchronize the schema. A database with no current complete policy is not production-ready. Before first application the reserved migration may be review-corrected. After facts exist, rollback application code while retaining the schema and immutable history, then forward-fix with a newly reserved migration. Restoring an older policy means appending a new publication, never updating history or the stored snapshot.

The production caller, publication authorization/approval route, cache-invalidation delivery, retention, and readiness composition remain deliberately unresolved. Therefore this package exposes no HTTP writer, default administrator, seeded Permission/Role/Grant, or production-ready claim.

## Protected Publication Command

`createProtectedAuthorizationPolicyPublisher` is an additive application-service boundary in front of the transactional publisher. Construction requires four explicit dependencies: the existing policy publisher, a server-side authorizer, the reviewed `platform.authorization.policy:publish` PermissionRequest, and an adapter to the separately owned management-audit capability. The declaration lives in the separate platform management permission catalog and does not create an HTTP surface or a default authorizer.

`createPlatformBaselineAuthorizationPolicy` converts the reviewed business-neutral platform HTTP and management permission catalogs into one complete assignment-scoped baseline snapshot. Its version, Role/Grant IDs, effective time and real active Assignment are mandatory controlled-release inputs; no production identity or default grant is embedded. The first protected publication must set `expectedPreviousVersion: null`. Later changes and restoration set the exact current version, so the PostgreSQL publisher checks the precondition under the same serialization lock used for publication and rejects stale or accidental bootstrap writes.

The command carries a stable management/publication identity, distinct stable audit operation IDs for authorization denial, authorization failure and publication failure, authenticated actor reference, complete current Workforce Person/active Assignment context, optional explicitly selected active Assignment, reason code, non-zero W3C Trace reference and complete non-empty v1 policy snapshot. The management operation ID is reserved for the successful publication fact. It snapshots and validates all command data before awaiting dependencies. Denial or authorization/audit failure prevents persistence; publication failures create a separate idempotent management-audit failure fact.

A success-audit failure after the PostgreSQL transaction commits is an uncertain-success result, not a rollback: callers retry the identical command and publication ID. The transactional publisher replays the commit, and the Audit Store replays the same successful management operation even though the retry creates a new durable authorization decision. Audit fingerprint semantics exclude `authorizationDecisionId`, while the authorizer adapter receives the stable management operation and Trace correlation so every authorization decision remains linked through the same safe Trace without mutating the management fact.

The application audit adapter maps `AuthorizationPolicyPublicationAuditRecord.auditOperationId` to Audit `trace.operationId`, maps the optional authorization decision reference to Audit `trace.authorizationDecisionId`, and maps the publication ID/version to a bounded authorization-policy resource reference. It must not use `managementOperationId`, `traceId`, `authorizationDecisionId`, timestamps or generated Audit IDs as the Audit Store receipt identity or semantic fingerprint.

This boundary does not solve first-policy bootstrap. With no current production policy, the normal policy-backed authorizer correctly fails closed and cannot authorize the first publication. Production activation still requires a protected verifier for the approved first-publication evidence, administrative transport, concrete audit adapter, real release identities/Assignment and execution evidence. Until those facts exist, no application should compose this service as a production write path.

Run the real local Redis adapter check after the local Compose stack is healthy:

```powershell
pnpm --filter @ai-crm/platform-authorization test:integration
```

The test reads the generated local Secret file without printing its value. Set `AI_CRM_AUTHORIZATION_REDIS_PASSWORD_FILE` to override its location. If the local runtime Secret file does not exist, the integration suite is skipped.

See [ADR-0007](../../../docs/08-架构决策/ADR-0007-自研轻量业务授权核心.md).
