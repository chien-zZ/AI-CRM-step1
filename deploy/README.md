# Deployment

Deployment configuration for local development, CI/testing, staging, and production. Production uses two Tencent Cloud Ubuntu CVMs with a separate Docker Compose project on each host; Docker Compose is not treated as a cross-host orchestrator.

PostgreSQL, Redis, RabbitMQ, Keycloak, Flowable, Nginx, and ClamAV are self-hosted for the first stage. Third-party component versions must be pinned and accompanied by health, resource, upgrade, backup, recovery, security, and license notes. Production secrets are injected by reference and never committed.

Production Secret values are stored as restricted files on each host and mounted per service with Docker Compose `secrets` or an equivalent read-only single-file mount. Vault, Tencent Cloud Secrets Manager, literal Compose Secret values, and production `.env` files are not used in the first stage. See [ADR-0023](../docs/08-架构决策/ADR-0023-文件式Secret与两台主机安全基线.md).

See [ADR-0021](../docs/08-架构决策/ADR-0021-第一阶段两台云服务器Docker-Compose部署.md), the [first-stage deployment scope](../docs/01-权威与基线/第一阶段部署范围.md), and the [deployment handbook](../docs/04-工程手册/部署与发布基线.md).

OPS-01 production artifacts are indexed by the [two-host Compose baseline](./compose/production/README.md), the [synthetic release manifest](./releases/release-manifest.example.json), and the [production release Runbook](../docs/04-工程手册/第一阶段生产发布Runbook.md). They remain blocked from real production use until CMP-01 confirms application runtime contracts and the later E2E/restore/security gates provide evidence.
