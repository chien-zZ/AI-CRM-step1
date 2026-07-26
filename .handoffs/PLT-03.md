# PLT-03 File Center handoff

- Task: `PLT-03`
- Branch: `task/PLT-03-file-center`
- Owner: Agent B
- Independent Reviewer: Agent D
- Status: `G2_ACCEPTED`
- Baseline: `6474690dffe2af0b8f73f76a1659733d94272d3e`
- Migration lease: `0000000010`
- Allowed paths: `packages/platform-modules/file-center/`, `contracts/files/`, `.handoffs/PLT-03.md`
- Shared-resource changes: none; `pnpm-lock.yaml`, generated contracts, `apps/api`, and `apps/worker` are unchanged

## Known Facts

- ADR-0012 assigns business-neutral file metadata, immutable content versions, short-lived transfer grants, malware-scanning state, cleanup/reconciliation, and stable `FileReference` values to File Center.
- Business modules may persist only stable file references. Storage buckets, object keys/handles, credentials, permanent provider URLs, provider SDK objects, and database types are private implementation details.
- Production object storage is reached only through an application-composed vendor-neutral `StorageAdapter`; this package contains no Tencent COS adapter or credential.
- Content becomes available only after trusted storage inspection and malware scanning. Declared client metadata is not authoritative.
- PostgreSQL schema changes use reviewed versioned SQL migrations. The Integration Owner assigned global migration number `0000000010`.
- Module G2 work does not compose `apps/api` or `apps/worker`; that remains the blocked `CMP-01` integration window.

## Allowed Assumptions

- An application composition root supplies current authorization, audit, scanner, storage, clock, IDs, size limits, and short grant/session TTLs.
- Owner modules use stable bounded identifiers and recheck their own resource state before asking File Center to link or authorize access.
- The storage adapter can implement idempotent delete and quarantine by private object handle; retrying either operation is safe.
- PostgreSQL supports transaction-scoped advisory locks and the repository-wide migration runtime.

## Forbidden Assumptions

- Do not infer CRM entities, fields, roles, retention periods, classifications, file size policy, or relation types.
- Do not treat an upload grant, notification, scan request, object existence, or transport acknowledgement as proof of an accepted business action.
- Do not expose or persist storage provider URLs as business facts, and do not let domain modules call storage or scanner vendors directly.
- Do not trust declared size/media type, client authorization claims, provider getters, or raw provider payloads.
- Do not auto-create schemas at application startup, guess migration numbers, edit generated artifacts, or modify shared composition entry points.

## Non-goals

- A real Tencent COS adapter, COS credential, production bucket policy, concrete ClamAV transport, HTTP controller, Worker consumer, retention policy, or CRM attachment flow.
- Anonymous/external access, generic external-user or invitation models, image transformation, content search, document preview, OCR, or AI processing.
- Permanent download URLs, cross-module database reads, or a replacement message transport beside Outbox/RabbitMQ/Inbox.

## Implementation

- Versioned JSON Schemas for `FileReference`, `ContentVersion`, `UploadSession`, `ResourceLink`, and short-lived upload/download grants.
- Strict runtime command validation, descriptor-safe validation of dependency return values, current authorization before protected lookup, attempted/denied/succeeded/failed audit outcomes, and safe typed errors.
- Initial upload plus immutable later content-version allocation with per-file serialization and idempotent operation replay.
- Trusted object inspection, upload completion, pending scan, clean availability, durable quarantine intent followed by idempotent storage isolation, explicit object-missing reconciliation, and durable cleanup intent followed by idempotent deletion.
- Business-neutral resource linking/unlinking and reauthorization for every download grant.
- In-memory test store, PostgreSQL transactional store, local filesystem development adapter, Drizzle schema declarations, and migration runner.
- Operation receipts and applicable lifecycle Outbox events committed with metadata state.

## Owner Self-review

### Authorization

- Every public command requires an actor and routes through `FileAuthorizer` before protected state is returned or changed.
- Initial upload is authorized by action/resource; later operations include the persisted owner module when available. Download checks both File Center access and the owning resource reference.
- Denial is audited and lookup ordering is tested so unauthorized callers cannot probe session existence.

### Idempotency

- Mutating commands use operation ID plus a canonical fingerprint. Reuse with different input fails with `file_center_operation_conflict`; identical replay returns the stored result.
- PostgreSQL serializes duplicate operations with advisory transaction locks. Later content-version allocation additionally serializes on stable `fileId`.
- Cleanup and quarantine persist intent before calling external storage and converge safely when the adapter recovers.

### Transactions

- PostgreSQL metadata mutations, operation receipts, and applicable Outbox events share one database transaction.
- External storage and scanner calls are outside database transactions; intermediate states (`pending_scan`, `quarantine_pending`, `cleanup_pending`) make recovery explicit.

### Migrations

- `0000000010_file_center_control_plane.sql` creates only the module-owned `file_center` schema, constraints, append/immutability guards, receipt table, and Outbox table.
- Empty-database migration and real PostgreSQL transaction tests pass. The migration is additive; automatic destructive rollback is forbidden. Stop writers and forward-fix, retaining the schema for application rollback.

### Observability and Audit

- The package emits no logs containing file content, provider payloads, URLs, credentials, personal data, or SQL parameters.
- Audit receives bounded identifiers, action/result, authorization decision reference, operation ID, reason, and trace ID. Lifecycle events contain stable references only.
- Runtime logs/metrics/traces remain the responsibility of `packages/observability` and the composition root; audit and Outbox remain separate facts.

### Backward Compatibility

- This is a new V1 public contract and additive schema. No existing API or generated client is changed.
- Public imports are exposed only through the package entry point. Database/Drizzle/runtime handles and storage object handles are not exported as cross-module contracts.

### Secrets

- No Secret, credential, bucket, provider account, production endpoint, or permanent URL is present. Adapter configuration is supplied by the application composition root through typed Secret-file references when a real adapter is later approved.
- Synthetic `.invalid` URLs and synthetic test actors are non-production fixtures.

### Failure Modes

- Authorization denial, invalid input, missing state, conflicting replay, expired/invalid session state, metadata mismatch, scanner unavailable, malicious/unscannable content, storage unavailable, cleanup retry, quarantine retry, and missing-object reconciliation are explicit.
- Provider-returned objects with accessors or unexpected properties fail closed without executing getters.
- Retryable adapter/scanner failures preserve a recoverable durable state; policy and authorization failures are non-retryable.

## Self-review Findings Fixed

1. Quarantine originally attempted storage isolation before persisting intent. Fixed with `quarantine_pending`, idempotent adapter retry, and a final durable completion event.
2. Dependency values were structurally read without rejecting accessors. Fixed with descriptor-safe allowlist validation; getters are never executed.
3. Resource links had a speculative one-file-per-resource/relation uniqueness rule. Removed because no accepted business rule owns that cardinality.
4. The first implementation exposed only content version 1. Added immutable subsequent-version upload, serialized version-number allocation, replay coverage, and immutable-trigger coverage.
5. Public TypeScript values and JSON Schemas lacked an executable alignment check. Added contract tests for all five V1 schema groups and explicit rejection of private storage fields.
6. Operation replay could mint an upload grant after the durable upload session expired or changed state, and could extend a grant beyond the session lifetime. Replays now reload current session state, reject inactive/expired sessions, and cap the grant to the durable session expiry.
7. Reconciliation consumed storage metadata without descriptor-safe validation. It now applies the same exact-property/accessor rejection as upload completion, with a regression test proving getters are not executed.
8. Resource linking authorized only the caller-supplied owning resource module, allowing an authorized caller to reference a file owned by another module without a second decision. Linking now authorizes both the resource owner and the persisted file owner before mutation.
9. A missing current resource link returned a denied error without a matching denied audit outcome. Download denial from current link state is now explicitly audited before returning.
10. Successful completion, scan, and reconciliation replays could re-run external inspection/scanning or fail after session expiry/object movement because service-level state checks ran before the store receipt. Command fingerprints are now stable before external work, durable receipts are read after current authorization, and regression tests prove stable replay without another provider call.

## Independent Review Round 1 Findings Fixed

1. **P1 bounded scan read:** `StorageAdapter.readObject` now requires `maximumBytes`; the local adapter checks the open file and reads at most the ceiling plus one detection byte in bounded chunks. The service independently rejects oversized adapter results before the scanner. Tests grow an object after completion and prove the scanner is never invoked.
2. **P1 quarantine path escape:** object and quarantine targets now share root-relative ancestor validation. Every existing ancestor must be a real directory inside the controlled root; symlinks/junctions fail closed. A regression test points the quarantine directory outside the root and verifies no outside write occurs.
3. **P2 partial quarantine convergence:** retries now inspect source/target binary and metadata states. A completed binary move with source metadata still present is repaired; missing or conflicting metadata fails explicitly. Quarantine success requires both isolated files.
4. **P1 reconciliation coordination:** reconciliation changes only missing `pending_scan`/`available` versions and preserves quarantine/cleanup/deleted states. Cleanup completion now requires an actual `cleanup_pending → deleted` content transition before marking the session cleaned. Unit and PostgreSQL tests cover both preserved intermediate states and the split-state rollback.
5. **P2 upload expiry TOCTOU:** completion captures the trusted cutoff after storage inspection. Both memory and PostgreSQL stores verify the locked session has not expired at that cutoff before any durable transition. A delayed-inspection regression test proves the session and version remain unchanged.

## Verification Evidence

- `pnpm --filter @ai-crm/platform-file-center typecheck` — passed 2026-07-26.
- `pnpm --filter @ai-crm/platform-file-center lint` — passed 2026-07-26.
- `pnpm --filter @ai-crm/platform-file-center test` — passed, 25/25 executable unit, contract-alignment, adapter, and package tests; 5 PostgreSQL tests correctly skipped in the unit command.
- `pnpm --filter @ai-crm/platform-file-center test:integration` — passed, 5/5 real PostgreSQL tests.
- `pnpm contracts:check` — passed, 28/28 packages.
- `pnpm check` — passed, 140/140 workspace tasks on the Round 1 fix candidate.
- `git diff --check` — passed; allowed-path audit contains only `packages/platform-modules/file-center/`, `contracts/files/`, and `.handoffs/PLT-03.md`.

## Independent Review

- Round 1: five findings received (P1 × 3, P2 × 2); all fixed with behavior regression coverage.
- Round 2: original Reviewer re-reviewed exact candidate `795c282df69f4aedd48721e12cb028ab3e56b01f`; all five Round 1 findings are closed, new actionable findings are zero, and unresolved architecture/contract issues are zero.
- Reviewer verification: unit/contract/adapter/package 25/25, PostgreSQL integration 5/5, contracts 28/28, `git diff --check`, clean worktree, and allowed-path audit all passed.
- Review dimensions: Authorization, Idempotency, Transactions, Migrations, Observability/Audit, Backward Compatibility, Secrets, and Failure Modes have no unresolved findings. Migration `0000000010` is unchanged; the same-work-package `StorageAdapter.readObject` change has all call sites updated.
- Actionable findings: zero.
- G2 acceptance: accepted after the Round 2 zero-finding re-review on 2026-07-26.
