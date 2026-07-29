# CMP-AUTH-POLICY-PUBLICATION Protected Policy Publication Boundary

- Status: INDEPENDENT REVIEW FIXES IMPLEMENTED; awaiting reviewer recheck, production activation blocked
- Owner: Authorization capability implementation
- Branch: `codex/cmp-auth-policy-publication`
- Allowed paths: `contracts/permissions/**`, `packages/platform-modules/authorization/**`, directly related documentation and this handoff

## Known Facts

- ADR-0025 is accepted and makes `authorization` the sole owner of immutable policy versions, publication history, the current-policy selection and authorization decision records.
- The PostgreSQL publisher already validates a complete non-empty v1 snapshot, computes a canonical digest, serializes publications, commits version/history/current selection atomically and replays the same publication ID only for identical content.
- Every production publication must be authorized against the current effective Workforce Person/Assignment context and must create management-audit evidence. Technical logs and authorization decision records do not replace management audit.
- Role-based ownership, approval and emergency procedure are confirmed by the 2026-07-29 G3 instruction; actual human/Organization mappings and the executed first publication remain production evidence.

## Allowed Assumptions

- A transport-neutral command boundary may require a stable authenticated actor reference, the complete current authorization subject, a stable management operation ID, publication ID, distinct stable audit operation IDs for denial/failure facts, reason code, safe non-zero W3C Trace ID and the full immutable policy snapshot.
- Application composition may inject the exact reviewed `PermissionRequest` after its Owner and declaration are accepted. The authorization package may require this injection without defining its eventual resource/action.
- A required management-audit port may accept bounded, business-neutral publication facts and idempotently record attempted/denied/failed/succeeded outcomes.
- The existing publication ID remains the persistence idempotency key. Retrying an identical command after an uncertain audit outcome must converge on the same publication and audit facts.

## Forbidden Assumptions

- Do not create or seed any real Workforce Person/Assignment identity or bypass the reviewed publication boundary. The business-neutral platform catalog may be compiled only with controlled release inputs.
- Do not invent a named person, HTTP endpoint, session convention or Assignment-selection transport.
- Do not trust a client-supplied allow result, actor identity, policy digest or partial/delta policy document.
- Do not treat an audit failure after a committed publication as a rollback. The caller receives a stable unavailable result and must retry the identical command.
- Do not expose policy contents, actor/workforce facts, raw errors, SQL, tokens, claims or provider payloads through logs or public errors.

## Non-goals

- No `apps/**` composition, production write API/UI, migration, database grant, cache invalidation delivery, real policy publication, seed, Compose or lockfile change.
- No decision about retention, SLA, RPO or RTO, and no repository mapping of governance roles to real people.
- No distributed transaction claim across authorization persistence and the separately owned audit capability.

## Intended Result

- Add a versioned contract for the complete protected publication command.
- Add an additive authorization package service that validates and snapshots the command, performs a fresh server-side authorization check, records management audit semantics, and only then invokes the existing transactional publisher.
- Keep production activation blocked until the real permission request, Owner, audit adapter and approved non-empty policy are supplied by reviewed application composition.

## Review Dimensions

- Authorization: exact injected permission; fresh `requireAllowed`; selected Assignment must belong to the supplied active set; denial/unavailability fails closed before publication.
- Idempotency: publication, operation and audit IDs are stable; exact retries converge; conflicting publication reuse remains rejected by the existing publisher.
- Transactions: policy version/history/current selection remain one PostgreSQL transaction; audit is a separate fact and no cross-module atomicity is claimed.
- Migrations: none; the accepted persistence migration already owns the physical publication facts.
- Observability: only stable errors leave the service; no policy body, identity data or raw dependency error is logged by this boundary.
- Backward compatibility: additive contract, types, factory and exports; existing publisher/store/service interfaces remain unchanged.
- Secrets: none.
- Failure behavior: invalid input, denial, authorizer failure, audit failure, publisher conflict/unavailability and uncertain post-commit audit all fail closed.

## Unresolved Production Blockers

- Concrete application-composed audit adapter and authorized administrative transport.
- An accepted bootstrap authority for the first non-empty policy. The normal current-policy authorizer cannot authorize that first publication while production correctly has no current policy; this service does not resolve or bypass that bootstrap deadlock.
- Real release identity/Assignment values and execution evidence for the generated first complete snapshot.

## G3 2026-07-29 Increment

- The current project-owner instruction confirms role-based governance without inventing people: `authorization` owns the capability, the project owner is accountable/approves, the Authorization capability owner submits, an independent reviewer reviews, and a protected Production Release Operator executes. Submitter and reviewer are distinct; emergency publication still requires project-owner approval and a non-executing reviewer, followed by access revocation and incident review.
- The protected command and PostgreSQL publisher now carry an optional optimistic `expectedPreviousVersion`. A first publication uses `null`; replacement or restoration uses the exact observed version. The check executes after the publication advisory lock and current-row lock, preventing a stale reviewer artifact or concurrent first-publication attempt from silently moving the current pointer.
- `createPlatformBaselineAuthorizationPolicy` builds a complete non-empty assignment-scoped snapshot from the reviewed platform permission catalog. It requires release-supplied immutable IDs, effective time and a real Organization-owned active Assignment; it contains no synthetic production identity and is never called by API startup or migration.
- Management publication audit remains mandatory through the existing protected boundary. The first-policy approval verifier/transport and Audit adapter must be supplied by the protected production release environment; technical logs, SQL access and authorization decision records do not replace it.
- Still external and therefore not fabricated in Git: the named human-to-role assignments, real Workforce Person/Assignment UUID, approved publication/version/operation IDs, release timestamp, and protected-environment approval evidence. Until those values are supplied and the command is executed against production PostgreSQL, API correctly remains Not Ready; tests demonstrate the boundary but are not publication evidence.
- Focused evidence: authorization test suite 53 passed/5 dependency-gated skipped; typecheck, lint, build, package contract check, repository contract generation/check, and `git diff --check` passed.

## Uncertain Success And Retry

- Policy persistence commits before the separately owned management-audit success fact. If that audit write fails or its commit cannot be confirmed, the service returns `AUTHORIZATION_UNAVAILABLE` and must not claim rollback.
- The successful management fact always uses the stable command `operationId`. Authorization denial, authorization dependency failure and publication failure use three distinct stable audit operation IDs so a retryable failure fact cannot conflict with a later success.
- Retrying the identical command re-authorizes the current actor context and reuses the same publication ID and success audit operation ID. The PostgreSQL publisher returns the already committed identical result; the Audit Store replays the same management fact because its fingerprint excludes the retry's new `authorizationDecisionId`.
- The authorizer port receives the stable management operation ID and non-zero Trace ID. Each authorization decision remains its own durable authorization fact and correlates through that Trace; retry decisions do not mutate the immutable management-audit record.

## Implemented

- Added `protected-policy-publication-command.v1.schema.json` with bounded actor/current workforce context, stable operation and publication IDs, reason, Trace reference and the complete non-empty v1 snapshot shape.
- Added `createProtectedAuthorizationPolicyPublisher` and additive public ports/types. Construction fails closed without an authorizer, exact context-free permission request, management-audit adapter or transactional publisher.
- Descriptor-safe command and authorization-decision snapshots reject accessors, sparse arrays, cycles, contradictory Assignment selection, malformed dates/IDs/non-zero Trace and widened objects before persistence.
- Authorization denial/unavailability creates bounded management-audit semantics and never reaches the persistence publisher. Audit records minimize workforce data to the Workforce Person and explicitly selected Assignment.
- Publication success/failure is management-audited. Success-audit uncertainty returns unavailable; an identical retry reuses the stable publication ID and converges through the existing PostgreSQL replay semantics.

## Self-review

- Authorization: no built-in permission, Owner, role or bypass; every call performs fresh `requireAllowed` against the complete validated current subject. First-policy bootstrap remains explicitly blocked.
- Idempotency: the existing stable publication ID remains the persistence idempotency key; success uses the stable management operation ID, while denial and retryable failure facts use distinct stable audit operation IDs. New retry decision IDs never change an Audit Store fingerprint.
- Transactions: unchanged PostgreSQL single-transaction version/history/current-pointer publication; audit remains a separate capability fact with documented uncertain-success behavior.
- Migrations: not applicable; no physical data change and no migration or runtime grant was added.
- Observability/audit: stable public errors only; no raw dependency error, policy body, Token, Claim, SQL or active Assignment set enters the audit record or technical telemetry.
- Backward compatibility: additive schema, factory, types and package-root exports; existing publisher, store, recorder and engine contracts are unchanged.
- Secrets: not applicable; no configuration or secret reference added.
- Failure behavior: malformed input/dependency results, denial, authorizer failure, audit failure, persistence conflict/unavailability and post-commit audit uncertainty all fail closed.

## Verification

- Authorization package before independent review: typecheck and lint passed; 43 tests passed and 6 environment-gated integration tests skipped.
- Contract source compilation/generation and repository contract checks passed.
- `git diff --check` passed.
- Full `pnpm check` passed: repository checks 40/40, Compose static gate, generated contract validation and Turbo 140/140.

## Independent Review/Fix

- P1 audit convergence: fixed. Audit identity no longer depends on a fresh authorization decision ID. Regression tests cover success-audit commit-then-throw, a retry with a new decision ID, and concurrent identical commands converging to one compatible successful Audit Store operation.
- P1 Trace: fixed. Contract and runtime reject the all-zero W3C Trace ID before authorization, audit or publication.
- P2 dependency mutation/accessors: fixed. Construction reads `audit.record`, `authorizer.requireAllowed` and `publisher.publish` through property descriptors, rejects accessors/proxy failures without executing getters, binds and freezes the methods, and ignores later dependency method replacement.
- Post-fix focused verification: authorization typecheck, lint, build and contract checks passed; 48 tests passed and 6 environment-gated integration tests skipped.
