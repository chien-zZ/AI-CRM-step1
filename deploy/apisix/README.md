# APISIX

APISIX is not deployed in the first-stage two-server Docker Compose topology. Nginx owns static and BFF/API routing, while authentication, authorization, Webhook verification, idempotency, and business policy stay in the application.

Do not add APISIX configuration unless a later ADR identifies a requirement that Nginx and the application boundary cannot meet. See [ADR-0021](../../docs/08-架构决策/ADR-0021-第一阶段两台云服务器Docker-Compose部署.md).
