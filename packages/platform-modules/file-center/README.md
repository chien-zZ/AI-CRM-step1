# File Center

Owns file metadata, upload sessions, immutable content versions, business-resource links, classifications, processing state, retention orchestration, and authorized download references.

Production binaries live in private Tencent Cloud COS through a vendor adapter; local development uses a filesystem adapter. ClamAV scans uploaded content before it becomes available. PostgreSQL stores metadata only, and RabbitMQ workers handle verification, scanning, cleanup, and reconciliation.

Consumers exchange stable `FileReference` values. They never receive COS buckets, object keys, credentials, permanent URLs, SDK objects, or direct database access.

See [ADR-0012](../../../docs/08-架构决策/ADR-0012-自研文件中心与腾讯云COS对象存储.md) and the [module description](../../../docs/03-模块说明/文件中心.md).
