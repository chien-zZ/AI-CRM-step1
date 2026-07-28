# FILE-STORAGE-CONFORMANCE

- Status: implementation and scoped verification complete; awaiting independent review and Integration Owner merge
- Date: 2026-07-28
- Owned paths: `packages/platform-modules/file-center/**` and this handoff

## Known facts

- The public vendor-neutral `StorageAdapter` port already exists in `@ai-crm/platform-file-center`.
- `LocalFileStorageAdapter` already implements that port for development and test use.
- ADR-0012 requires local storage and a future real COS adapter to execute the same storage contract tests.

## Allowed assumptions

- A future reviewed provider adapter can reuse the same private test harness through test-side fixture hooks.
- Test fixtures may supply an opaque valid object handle and seed content without requiring the production adapter to expose internal handles or diagnostic APIs.

## Forbidden assumptions

- Do not add a COS SDK, COS configuration, provider DTO, credential, Bucket, Object Key policy, endpoint, region, or provider error payload.
- Do not infer provider retry values or claim that the local adapter or this harness proves production readiness.

## Non-goals

- No API, Worker, Compose, HTTP/file contract, migration, generated artifact, package dependency, Lockfile, or consumer change.
- No production storage adapter, production Secret, scanner adapter, RabbitMQ route, or consumer activation.

## Implementation

- A private test harness exercises only the public `StorageAdapter` operations. It uses test-owned opaque handles and fixture callbacks; adapters do not expose their internal handle state.
- The common gate covers upload/download grant input propagation and exact public result shapes, inspection and bounded reads, repeated quarantine/delete convergence, deletion of absent objects, invalid handle rejection, and missing-object failure classification.
- `LocalFileStorageAdapter` runs the common gate while its filesystem-specific immutability, symlink escape, partial quarantine repair, and grow-after-inspection tests remain local.
- The package README records that a real COS test Bucket must pass the identical gate before production acceptance.

## Verification evidence

- `pnpm --filter @ai-crm/platform-file-center test`: passed, 29/29 executable package tests; 5 PostgreSQL integration tests correctly skipped by the ordinary unit command.
- `pnpm --filter @ai-crm/platform-file-center typecheck`: passed.
- `pnpm --filter @ai-crm/platform-file-center lint`: passed with zero warnings.
- `git diff --check -- packages/platform-modules/file-center .handoffs/FILE-STORAGE-CONFORMANCE.md`: passed.

## Eight-area review

- Authorization: unchanged; the adapter port receives only server-owned private handles after service authorization.
- Idempotency: repeated quarantine and delete convergence is executable in the shared gate.
- Transactions: unchanged; storage calls remain outside PostgreSQL transactions and converge through durable control-plane states.
- Migrations: none.
- Observability/Audit: no logging or telemetry was added; grant URLs, content, handles, and provider payloads are not logged.
- Backward compatibility: the production package public entry point and `StorageAdapter` signature are unchanged; the harness is test-private.
- Secrets: no credential, Secret reference, provider account, endpoint, or Bucket was added.
- Failure modes: the gate asserts invalid input, policy ceiling, missing object, retryable storage unavailability, and idempotent convergence behavior.
