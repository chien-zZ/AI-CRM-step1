# Deployment Secrets

Production uses host-managed restricted files and Docker Compose `secrets`, not Vault, Tencent Cloud Secrets Manager, literal Compose values, or a production `.env` file.

Only documentation, schemas for non-secret inventory metadata, and safe validation tooling belong in this directory. Runtime values must live outside the repository under the approved host Secret root and be mounted read-only into only the consuming container, preferably at `/run/secrets/<name>` with `*_FILE` configuration.

Never commit encrypted production Secret bundles here. Disaster-recovery bundles are encrypted before upload with an offline `age` recipient and stored in a separately restricted COS location; the decryption key is not present on production hosts or in COS.

See [ADR-0023](../../docs/08-架构决策/ADR-0023-文件式Secret与两台主机安全基线.md), the [first-stage scope](../../docs/01-权威与基线/第一阶段Secret与主机安全范围.md), and the [security baseline](../../docs/09-安全与数据治理/Secret与主机安全基线.md).
