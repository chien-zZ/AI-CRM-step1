# PLT-02 Form Schema And Business Configuration

- Status: G2_ACCEPTED
- Branch: `task/PLT-02-form-configuration`
- Owner: Agent B
- Independent Reviewer: Agent D
- Allowed paths: `packages/platform-modules/form-schema`, `packages/platform-modules/business-configuration`, `contracts/forms`, `contracts/configuration`, and this handoff

## Known Facts

- ADR-0013 accepts JSON Schema 2020-12 with strict Ajv, a controlled UI Schema, immutable form releases, and versioned dictionaries and typed parameters.
- Published artifacts are immutable. Runtime and historical facts bind exact versions and content digests rather than a mutable current value.
- PostgreSQL is the fact source. Redis is a replaceable cache; Outbox/RabbitMQ propagation is a reliable invalidation path, not the publication or activation fact.
- Form definitions never own submitted domain data. Business configuration never owns deployment configuration or Secrets.
- Migration `0000000007` is reserved for `form-schema`; `0000000008` is reserved for `business-configuration`.

## Allowed Assumptions

- Stable business-neutral identifiers use bounded machine codes and Owner module IDs.
- The first controlled form dialect supports bounded object schemas, local `$defs` references, primitive fields and arrays; UI metadata uses a small registered component/layout allowlist.
- Parameter definitions explicitly declare primitive value type, validation Schema, allowed opaque scope types with unique priorities, and a fail-closed or typed-default missing policy.
- Higher numeric scope priority wins when multiple supplied opaque scopes have an effective activation; this transport-neutral rule is explicit in `contracts/configuration/parameter-definition.v1.schema.json`.
- Cache implementations may fail; resolution falls back to PostgreSQL. Invalidation events use stable release/activation IDs and idempotent consumers.

## Forbidden Assumptions

- Do not create CRM forms, customer/student/lead fields, dictionary codes, SLA values, roles, permissions, approval routes, or concrete scope hierarchies.
- Do not allow remote `$ref`, arbitrary formats/keywords, scripts, HTML, SQL, templates, expressions, component imports, URLs, Secrets, submitted data, or dynamic database fields.
- Do not make UI visibility or client validation authoritative. Do not treat Redis, RabbitMQ, a scheduled message, or an Outbox row as the configuration fact.
- Do not modify generated contracts, API Client, root Lockfile, shared configuration, `apps/api`, or `apps/worker`.

## Non-goals

- No visual designer, React renderer, HTTP adapter, production Redis adapter, RabbitMQ publisher, Workflow approval, submitted form store, provider integration, or real business fixture.
- No retroactive migration of domain data and no automatic migration at application startup.

## Authorization, Audit And Idempotency

- Draft writes, publication, activation and termination require injected authorization and audit ports. Mutations perform a coarse resource-independent authorization check before any Store lookup, then repeat authorization with the resolved immutable Owner before changing facts. Denied and failed attempts fail closed with stable errors.
- UUID operation IDs identify semantic writes. Stores atomically persist state, operation receipts and module-owned Outbox invalidation facts; changed payload reuse conflicts.
- Read/validation calls consume an exact published version. Configuration resolution consumes explicit scopes and time and returns complete provenance.

## Transactions, Migrations And Recovery

- Module Store transactions never escape their package. Publication/activation facts and their Outbox rows commit atomically.
- Migrations are additive empty-schema migrations. Published rows and activation/termination facts have database update/delete guards; drafts remain mutable through optimistic revisions. An open-ended activation is ended by appending an immutable termination fact, never by updating the activation row, and termination cannot be backdated before its recorded occurrence.
- Before first application, review corrections may update reserved migrations. After application, repairs require newly reserved forward migrations; rollback retains published historical facts.

## Failure And Compatibility

- Unknown dialect keywords/components/formats, excessive depth/size, remote references, invalid typed values, overlapping activations, missing required values and malformed dependency results fail closed.
- Cache failure falls back to PostgreSQL; cache write/invalidation failure never changes the fact. Outbox consumers are idempotent and reconcilable.
- Contracts are additive V1. New releases do not alter old form validation, dictionary display, parameter resolution, or domain facts bound to historical references.

## Verification And Review

- Required: package build/lint/typecheck/unit tests, real PostgreSQL empty migration and transaction/immutability tests, contract generation check, `pnpm check`, and `git diff --check`.
- Owner self-review and independent review both cover Authorization, Idempotency, Transactions, Migrations, Observability, Backward Compatibility, Secrets and Failure Modes.
- PLT-02 is not G2 accepted until the same independent Reviewer reports zero actionable findings after all repair rounds.

### Owner Verification Evidence

- `pnpm --filter @ai-crm/platform-form-schema typecheck`, `lint`, `test`: passed 2026-07-26 after Review Round 1 repairs; 9/9 executed tests passed and PostgreSQL-only tests were intentionally skipped in the unit command.
- `pnpm --filter @ai-crm/platform-business-configuration typecheck`, `lint`, `test`: passed 2026-07-26 after Review Round 1 repairs; 9/9 executed tests passed and PostgreSQL-only tests were intentionally skipped in the unit command.
- `pnpm --filter @ai-crm/platform-form-schema test:integration`: passed 2026-07-26 against an isolated PostgreSQL 17.5 container; 2/2 tests passed.
- `pnpm --filter @ai-crm/platform-business-configuration test:integration`: passed 2026-07-26 against an isolated PostgreSQL 17.5 container; 4/4 tests passed, including immutable termination, historical resolution, duplicate replay, replacement serialization, and database guards.
- `pnpm contracts:check`: passed 2026-07-26 after Review Round 1 repairs; contract sources and generated artifacts were deterministic and 28/28 package checks passed.
- `pnpm check`: passed 2026-07-26 after Review Round 1 repairs; 140/140 Turbo tasks passed.
- `git diff --check`: passed 2026-07-26 after Review Round 1 repairs.
- No generated artifact, root Lockfile, application composition path, or file outside the PLT-02 ownership set was modified. The Integration Owner still owns the frozen-Lockfile merge window.

### Owner Self-review Round 1

- Authorization: mutation authorization is evaluated before Store writes; existing draft Owners are stable and cannot be replaced during revision; form release activation uses the release Owner; denied mutations are audited and fail closed. Reads use resource-scoped authorization. No permission, role, or policy is invented.
- Idempotency: UUID operation receipts and semantic fingerprints are stored in the same transaction as facts and Outbox rows. Identical retries replay; changed-payload reuse conflicts. PostgreSQL advisory locks serialize concurrent duplicate operations.
- Transactions: draft writes, publication, activation/status changes, receipts, and Outbox rows are atomic. Resource-level advisory locks serialize version allocation and overlapping activation checks. Integration tests reproduce duplicate and overlap races.
- Migrations: reserved migrations `0000000007` and `0000000008` create empty module-owned schemas only. Published releases, parameter definitions/values, and activation facts have database update/delete guards. Recovery and forward-fix guidance is recorded in migration metadata.
- Observability: these packages are libraries, not independently running components, so health endpoints, runtime metrics, and logger composition are not applicable here. Stable sanitized errors, injected audit records, trace/operation references, receipts, and reconcilable Outbox facts provide the module evidence surface without logging payloads or personal data.
- Backward Compatibility: all public artifacts are additive V1 contracts. Exact release/value versions and content digests preserve historical behavior; mutable form active state is separate from immutable releases. Dictionary codes published in history cannot disappear from later releases.
- Secrets: no Secret values, provider credentials, deployment configuration, provider URLs, or permanent object-storage references are accepted or stored. Migration integration uses temporary restricted files that are removed in `finally`; string configuration rejects common credential material case-insensitively.
- Failure Modes: malformed dependencies and inputs fail closed with stable errors; invalid/poisoned cache values are ignored after validation against the immutable parameter definition; cache get/set failures fall back to PostgreSQL; invalidation failures are retryable; missing values, stale revisions, overlaps, constraint failures, and unavailable dependencies have tests or explicit stable mappings.
- Business neutrality: source, contracts, migrations, and fixtures contain only synthetic platform identifiers and opaque scope references. No CRM entity, field, state, SLA, role, approval route, provider, Prompt, anonymous endpoint, or external-user model was added.
- Findings repaired during self-review: PostgreSQL NUL-delimited scope matching was replaced by paired `unnest` arrays; resource locks were added for concurrent version allocation; mutable draft Owner takeover was blocked in service and PostgreSQL Store; cached values are checked against the immutable definition; activation facts gained database immutability protection. Actionable Owner findings remaining: zero.

### Independent Review

- Reviewer: Agent D.
- Round 1 findings:
  - P1: form `date` and `date-time` validation accepted lexically valid but nonexistent Gregorian dates.
  - P1: a structurally valid poisoned cache entry could be returned for the wrong scope or effective time without Store provenance.
  - P1: an open-ended parameter activation had no immutable termination/replacement path.
  - P2: resource mutations looked up Store state before authorization and could disclose resource existence through dependency behavior.
- Round 1 repairs:
  - Added strict Gregorian calendar validation, including leap years, month lengths, and bounded time components, with regression tests.
  - Reduced cache data to a hint: requested scope/type/time are checked and the Store recomputes the effective activation/value/default; a cached result is used only when its full provenance hash matches the Store fact.
  - Added additive V1 activation-termination contract and immutable termination facts. Scope advisory locks serialize termination and replacement; the effective end is the earlier of the original end and termination, and service, memory Store, PostgreSQL Store, and database constraints reject backdating.
  - Added two-stage mutation authorization so a denied coarse check performs no Store lookup, followed by the existing Owner-aware authorization before mutation; regression tests cover both modules.
- Round 1 repair self-review: Authorization, Idempotency, Transactions, Migrations, Observability, Backward Compatibility, Secrets and Failure Modes were rechecked. No remaining Owner finding was identified. The termination contract is additive; receipts and advisory locks preserve retry/concurrency behavior; no payload, Secret, provider, CRM rule, or mutable historical fact was introduced.
- Round 2: the same Reviewer re-reviewed exact repair commit `f881ab8268f1d70bc4198bc15d4119b7d3d9b03b` and reported zero P0-P3 actionable findings and zero unresolved architecture or contract issues.
- Round 2 verification: Form typecheck/lint/unit 9/9 and PostgreSQL 2/2 passed; Configuration typecheck/lint/unit 9/9 and PostgreSQL 4/4 passed; contracts 28/28 and diff check passed.
- Round 2 review dimensions: Authorization, Idempotency, Transactions, Migrations, Backward Compatibility, Secrets and Failure Modes passed. Runtime health/logger composition is not applicable to these library modules; sanitized audit, trace, receipt and Outbox evidence remains explicit. Reserved migrations `0000000007` and `0000000008` are still unmerged and undeployed, so the reviewed corrections remain within the authorized pre-application migration window.
- Actionable findings: zero.
- G2 decision: `G2_ACCEPTED` on 2026-07-26. Merge remains subject to the Integration Owner's dependency order, migration/Lockfile windows and main-branch evidence gate.
