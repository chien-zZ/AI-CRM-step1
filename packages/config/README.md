# Configuration

Typed deployment-time configuration loading, startup validation, and environment conventions. It owns service addresses, connection settings, timeouts, feature wiring, and secret references, but not business dictionaries, runtime business parameters, or form definitions.

Production Secrets are read through typed `*_FILE` references from per-service read-only files, normally mounted by Docker Compose under `/run/secrets/`. This package validates presence, format, and compatibility without logging values and fails closed when a required Secret is unavailable. It does not implement a vault, persist Secret values, or expose them to domain modules and clients.

Non-secret deployment settings may use validated environment variables. Production Secret values must not appear in environment values, Compose YAML, Git, the business-configuration database, logs, Sentry, or frontend artifacts. See [ADR-0013](../../docs/08-架构决策/ADR-0013-版本化表单与业务配置中心.md) and [ADR-0023](../../docs/08-架构决策/ADR-0023-文件式Secret与两台主机安全基线.md).
