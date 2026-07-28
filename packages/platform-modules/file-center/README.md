# File Center

Owns file metadata, upload sessions, immutable content versions, business-resource links, classifications, processing state, retention orchestration, and authorized download references.

Production binaries live in private Tencent Cloud COS through a vendor adapter; local development uses a filesystem adapter. ClamAV scans uploaded content before it becomes available. PostgreSQL stores metadata only, and RabbitMQ workers handle verification, scanning, cleanup, and reconciliation.

Every storage implementation must pass the same private `StorageAdapter` conformance harness used by `LocalFileStorageAdapter`. The harness verifies transfer-grant input propagation and bounded public output, trusted inspection and bounded reads, idempotent delete/quarantine convergence, and stable invalid-handle/missing-object failure classification. A real COS adapter is not accepted or production-ready until it passes this gate against a reviewed test Bucket; the local adapter cannot substitute for that evidence.

Consumers exchange stable `FileReference` values. They never receive COS buckets, object keys, credentials, permanent URLs, SDK objects, or direct database access.

The V1 service supports the complete business-neutral lifecycle: create an initial upload session, append immutable content versions to the same stable file, inspect provider metadata, scan before availability, link or unlink an available version, authorize a fresh short-lived download, clean abandoned uploads, and reconcile missing objects. Every command requires an explicit actor, reason, operation ID, and trace ID; current authorization is checked before protected state is revealed, and durable PostgreSQL mutations use operation receipts plus an Outbox event in the same transaction where a lifecycle event applies.

`StorageAdapter.readObject` receives a mandatory byte ceiling and must enforce it while reading; the service also rejects an oversized adapter result before invoking the scanner. The local adapter performs a bounded chunked read and validates every ancestor used by both object and quarantine paths, rejecting symbolic links/junctions. Quarantine retries converge only when both the binary and its metadata are isolated consistently.

Upload completion uses the trusted post-inspection `completedAt` as its atomic cutoff. The store locks the session and verifies that cutoff is earlier than the durable expiry before changing either session or content state. Reconciliation changes only stable states where the original object must exist (`pending_scan` and `available`); it never overwrites `quarantine_pending`, `cleanup_pending`, `quarantined`, or `deleted`, and cleanup completion requires the content transition to `deleted` to succeed before the session becomes `cleaned`.

Production persistence uses migration `0000000010_file_center_control_plane.sql`. Apply it through the reviewed migration runner; startup must never synchronize schemas automatically. The migration is additive. Rollback guidance is to stop writers, retain the schema for application rollback, and use a reviewed forward fix; dropping `file_center` destroys metadata and is not an automatic rollback.

Verification commands:

- `pnpm --filter @ai-crm/platform-file-center test`
- `pnpm --filter @ai-crm/platform-file-center test:integration`
- `pnpm --filter @ai-crm/platform-file-center typecheck`
- `pnpm --filter @ai-crm/platform-file-center lint`
- `pnpm contracts:check`

See [ADR-0012](../../../docs/08-架构决策/ADR-0012-自研文件中心与腾讯云COS对象存储.md) and the [module description](../../../docs/03-模块说明/文件中心.md).
