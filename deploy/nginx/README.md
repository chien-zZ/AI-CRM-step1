# Nginx

Nginx serves approved static client artifacts and routes same-site BFF/API traffic to the application replicas in the first-stage two-server deployment. It may provide TLS configuration, request-size/time limits, correlation headers, and coarse edge rate limits.

Authentication, object-level authorization, Webhook verification, idempotency, validation, and business policy remain in the application. Nginx configuration must not expose Keycloak, Flowable, PostgreSQL, Redis, RabbitMQ, ClamAV, or operator endpoints publicly.

See [ADR-0021](../../docs/08-架构决策/ADR-0021-第一阶段两台云服务器Docker-Compose部署.md).
