# PLT-01 Audit And Application Registry

- Status: G2_ACCEPTED; independent re-review zero findings; awaiting Integration Owner serial merge
- Branch: `task/PLT-01-audit-app-registry`
- Owner: Agent B
- Independent Reviewer: Agent D
- Allowed paths: `packages/platform-modules/audit`, `packages/platform-modules/app-registry`, corresponding source contracts and module migrations, this handoff

## Known Facts

- Audit is durable security evidence, not application logging, metrics, Sentry, or inferred telemetry.
- Audit facts require Actor/effective context, Action, Resource, Result, Reason, Trace, and controlled changes; records are append-only.
- Application Registry owns stable application/navigation/route IDs, enablement, audience, relative route templates, and permission references.
- Task and Notification links carry registered identifiers and a stable resource reference, never an arbitrary URL or proof of authorization.
- External clients must not load internal registrations; every deep-link resolution rechecks current target authorization and enablement.
- Audit migration `0000000005` and App Registry migration `0000000006` were reserved by the Integration Owner.

## Allowed Assumptions

- Stable identifiers and permission references use bounded business-neutral codes; PLT-01 persists no display copy or real permission grants.
- Audit action Owners explicitly register a field allowlist. Non-sensitive differences are bounded JSON scalars; sensitive fields record only that a change occurred.
- UUID operation IDs identify semantic writes. Trace and generated Audit ID/time may change on retry without changing the semantic operation fingerprint.
- A Registry audit adapter treats `(operationId, result)` as the idempotency identity for attempted/final records and can retry the final record after a committed Registry mutation.
- Registered route paths are relative templates. Resource references are returned separately and are not interpolated into a URL by this module.

## Forbidden Assumptions

- Do not infer audit facts from Pino, Sentry, traces, request/response bodies, SQL, or log keywords.
- Do not store credentials, cookies, tokens, provider payloads, prompts/responses, customer content, or sensitive Before/After values in Audit.
- Do not create CRM applications, routes, navigation, roles, grants, fields, states, SLAs, approval routes, or real identities.
- Do not accept absolute/protocol-relative URLs, queries, fragments, traversal, arbitrary deep-link sources, or frontend visibility as authorization.
- Do not expose internal registrations through the external audience or trust a previously resolved deep link after disablement or permission changes.

## Non-goals

- No HTTP adapter, API/Worker composition, generated API Client, UI, seed data, or root manifest/Lockfile update.
- No audit retention schedule, legal hold, break-glass workflow, export, cryptographic sealing, or security-operations UI.
- No Registry display-name localization, icon catalog, route rendering engine, external invitation model, or domain resource resolver.
- No automatic migration at application startup and no cross-module table or Repository access.

## Contract And Behavior

- `contracts/audit/audit-record.v1.schema.json` defines the explicit append-only V1 fact and sensitive/non-sensitive change forms.
- `contracts/app-registry/application-registry.v1.schema.json` and `deep-link.v1.schema.json` define stable registry entries and URL-free Task/Notification links.
- Audit records are accepted only through action-specific field policies. Sensitive reads authorize the current actor for the target record and write denied/failed/succeeded access before data can escape.
- Audit retries return the first Audit ID. Concurrent identical operations serialize; changed semantic payload reuse fails with `audit_operation_conflict`.
- Registry management authorizes before any mutation, records attempted/final audit calls, and atomically commits state plus its idempotency receipt.
- Registry load filters audience at the Store boundary, then enablement and current application/route authorization. Deep links additionally verify source allowlist, current application/route enablement, and target authorization.
- Stable public errors fail closed and do not distinguish a missing target from disabled or audience-mismatched targets.

## Migration Guidance

- `0000000005_audit_append_only_core` creates the empty `audit` schema. Database triggers reject UPDATE/DELETE for records and receipts; application rollback retains evidence.
- `0000000006_application_registry_core` creates the empty `app_registry` schema with application/route/navigation referential constraints and operation receipts.
- Both migrations are additive, module-owned, use no backfill, and are tested from an empty PostgreSQL baseline. Review Round 1 added the self-parent check directly to reserved migration `0000000006` before G2, merge, or first application; after application, repairs require a new reserved forward migration and applied SQL is never edited.
- Module migration commands require `DATABASE_MIGRATION_URL_FILE`; runtime accounts do not receive DDL behavior from these packages.

## Failure And Recovery

- Invalid facts, undeclared differences, arbitrary paths, authorization denial, disabled/mismatched links, Store failure, and operation conflicts fail closed with stable codes.
- Audit persistence failure prevents a fact or sensitive record from escaping. A missing sensitive target records failed access before returning not-found.
- Registry attempted-audit failure prevents mutation. State and receipt commit atomically; if final audit fails after commit, retry replays the state operation and retries audit without repeating the mutation.
- PostgreSQL transaction rollback owns partial database failures. No distributed transaction with Authorization or Audit is claimed.

## Shared Resource Requests

- Integration Owner must update only the `audit` and `app-registry` importers in `pnpm-lock.yaml` for the new existing workspace/database and Drizzle dependencies, then verify with frozen install. This branch did not modify the Lockfile.
- Contract generation check reports current generated artifacts valid and deterministic; this branch did not modify `contracts/generated` or API Client artifacts because the added contracts are standalone JSON Schemas.
- `apps/api`, `apps/worker`, platform SDK composition, health/metric wiring, and concrete Audit/Registry authorization/audit adapters remain for CMP-01 after G2.

## Verification Evidence

- Audit unit/package tests: 8 passed; default run skips 3 environment-gated PostgreSQL cases.
- Application Registry unit/package tests: 13 passed; default run skips 4 environment-gated PostgreSQL cases.
- Real PostgreSQL 17.5: Audit 3/3 passed for empty migration, replay/readback, database-enforced immutability, and concurrent duplicate serialization.
- Real PostgreSQL 17.5: Registry 4/4 passed for registration/disablement, internal-to-external isolation, concurrent duplicate serialization, and database rejection of self-parent navigation.
- `pnpm contracts:check`: 28/28 packages passed; source schemas compile under strict Ajv and generated artifacts are deterministic.
- `pnpm check`: 140/140 Turbo tasks passed after final fixes; repository boundaries and Compose static checks passed.
- `git diff --check`: passed. `pnpm-lock.yaml`, `contracts/generated`, `apps/api`, and `apps/worker` remain unchanged.

## Owner Self-Review And Repair Loop

### Round 1: Public Boundary, Authorization, And Safe Inputs

- Replaced placeholder exports with explicit service/port types while keeping Stores, Drizzle rows, schemas, and transaction handles out of the package root.
- Registry management now authorizes before mutation; loads and deep links reauthorize current application/route targets. External audience filtering occurs in the Store query, and disabled/unknown/mismatched targets share a closed error.
- Arbitrary URLs, traversal, query/fragment input, undeclared difference fields, and value-bearing sensitive changes are rejected.

### Round 2: Idempotency, Transactions, And Migrations

- Fixed generated Audit ID/time causing valid retries to conflict: semantic fingerprints exclude generated/time/Trace correlation, and replay returns the original Audit ID.
- Added transaction-scoped advisory locks for operation IDs so concurrent duplicate Audit and Registry writes deterministically return one original plus one replay rather than a unique-key race.
- Removed duplicated Audit JSON payload storage; records reconstruct from constrained owned columns so there is one database fact representation.
- Added database append-only triggers, empty-baseline integration tests, cross-application navigation constraints, migration metadata, and forward-only recovery guidance.

### Round 3: Audit, Failure Semantics, And Compatibility

- Sensitive reads now record final denied/failed/succeeded access before returning data. Registry mutations record denied, attempted, failed, and succeeded outcomes through the required audit port.
- Authorization-port exceptions and audit-port exceptions now map to stable retryable unavailable errors; explicit deny remains a stable non-retryable denial.
- Documented the recoverable final-audit failure window: retry replays the committed Registry operation and retries phase-idempotent audit; no distributed transaction is claimed.
- Contracts are additive V1 schemas; former package entries exported only `packageId`, so there is no removed public runtime or persisted data to migrate.
- Owner final self-review found no additional actionable issues in Authorization, Idempotency, Transactions, Migrations, Observability, Backward Compatibility, Secrets, or Failure Modes; this does not replace independent re-review.

## Independent Review Round 1 Repair Loop

The independent Reviewer reported six actionable findings: four P1 and two P2. The Owner repaired all six and added regression coverage; the work package remains outside G2 until the same Reviewer confirms zero actionable findings.

1. P1 Deep-link authorization: resolution now authorizes the current application permission before the route/resource permission. Either denial fails closed, and application denial stops before route authorization or target disclosure.
2. P1 Runtime validation: Audit and Registry public inputs now require exact object keys and validate nested objects, discriminated unions, enums, booleans, finite scalars, arrays, versions, actors, and authorization decisions at runtime. Services persist and forward reconstructed allowlisted values rather than spreads of untrusted commands.
3. P1 Canonical idempotency: both modules use recursive key-sorted canonical serialization. Audit change arrays are normalized by unique field, and Registry route source sets are normalized, while true semantic changes still conflict.
4. P1 Navigation self-parent: runtime validation and Memory Store invariants reject self-parent navigation; migration `0000000006` and its private Drizzle schema now enforce the same check in PostgreSQL.
5. P2 Ancestor-closed snapshots: Registry navigation includes a child only when every ancestor is present, enabled, and backed by a currently authorized route; missing parents and cycles also fail closed.
6. P2 Memory Store encapsulation: every Registry `find*` and `list*` read returns a deep snapshot, including nested route source arrays, so caller mutation cannot change persisted enablement or authorization inputs.

Owner regression evidence includes application-denied/route-allowed deep links, invalid runtime objects and sensitive extra fields, reordered object/change/source retries, disabled and denied navigation parents, caller mutation of every Memory Store read shape, runtime self-parent rejection, and PostgreSQL constraint rejection. During the PostgreSQL rerun, the pre-existing Audit concurrency assertion was corrected to avoid assuming which concurrent Promise acquires the advisory lock; it now verifies one original result, one replay, and one shared winning Audit ID.

### Round 1 Eight-Area Recheck

- Authorization: application and route permissions are both current and mandatory; invalid authorization decisions fail closed as dependency unavailability.
- Idempotency: canonical semantic fingerprints accept property/change/source reordering and continue rejecting meaning changes.
- Transactions: Store state and receipt boundaries are unchanged; PostgreSQL advisory serialization is covered without assuming contender order.
- Migrations: the reserved, unmerged, unapplied `0000000006` was corrected before G2 and tested from an empty PostgreSQL 17.5 database; no applied migration was edited.
- Observability: stable bounded errors and safe correlation identifiers remain unchanged; no bodies, personal data, provider payloads, or unbounded strings were added.
- Backward Compatibility: wire contracts remain additive V1; stricter runtime rejection aligns implementations with existing `additionalProperties: false`, enums, and scalar schemas.
- Secrets: no Secret value or production configuration was added; PostgreSQL test Secrets remained temporary files removed with their containers.
- Failure Modes: authorization denial, invalid dependency decisions, broken ancestor chains, mutation attempts on read snapshots, semantic conflicts, and database self-parent writes all fail closed with regression coverage.

## Eight-Area Review Summary

- Authorization: mandatory management and target ports, no default allow, external filtering at Store boundary, no frontend authority.
- Idempotency: semantic operation fingerprints, original result replay, concurrent advisory serialization, conflict on changed meaning.
- Transactions: module state/receipt atomic; Audit record/receipt atomic; external authorization/audit boundaries explicitly non-transactional with retry behavior.
- Migrations: additive, globally reserved numbers, module isolation, no startup sync/push, immutable repair guidance, real empty-database evidence.
- Observability: stable bounded errors and Trace references only; no logger/vendor dependency or unsafe telemetry. CMP-01 owns concrete health/metric composition.
- Backward Compatibility: additive packages/contracts/schemas with no previous behavior or data; stable V1 wire shapes.
- Secrets: no values, credentials, production environment files, provider payloads, or permanent URLs; integration Secrets were random files removed with containers.
- Failure Modes: authorization/store/audit outages, duplicates/conflicts, invalid input, missing/disabled/audience mismatch, partial final audit, and migration failure all have closed behavior or explicit retry/forward-fix guidance.

## Unresolved Questions

- Audit retention, legal hold, security reviewer permissions, export, sealing, and break-glass rules require accepted governance decisions.
- Concrete Audit action/field policy registrations and Registry applications/routes/permissions belong to confirmed capability Owners and CMP-01 composition.
- Formal application display metadata, localization, icons, external registrations, and resource-specific deep-link parameter rules remain unconfirmed.

## Independent Re-review Result

The same independent Reviewer re-reviewed fix commit `9c60ffa` and confirmed all six Round 1 findings closed with no new actionable P0-P3 finding. The Reviewer reran Audit 8/8 and Application Registry 13/13 unit tests plus both package typechecks, and verified shared forbidden paths remained unchanged.

Eight-area conclusion: application and route authorization both fail closed; canonical idempotency normalizes semantic sets; local state/receipt transaction boundaries remain atomic; the self-parent migration constraint matches runtime validation and the documented pre-G2 migration policy; observability remains bounded; V1 changes remain additive; no Secret or provider data was introduced; malformed inputs and invalid dependency decisions fail closed.

PLT-01 is therefore `G2_ACCEPTED`. Merge remains a separate Integration Owner action and must preserve the recorded Lockfile and generated-artifact windows.
