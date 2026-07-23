# Eventing And Outbox

Owns the project-specific transactional Outbox/Inbox adapters, event envelope validation, RabbitMQ publication and consumption policies, retries, reconciliation, and dead-letter handling. Redis may accelerate cache and short-lived coordination but is not a durable message or idempotency source.

Domain event contracts remain transport-neutral. Domain modules use the public platform interface and contracts; they do not depend directly on RabbitMQ, Redis, or Outbox/Inbox tables.

Approved asynchronous provider calls use this module for durable transport and consumer idempotency, then pass through the owning capability port and provider adapter. `integration-runtime` does not create a second message bus or make provider delivery a domain fact.

See [ADR-0010](../../../docs/08-架构决策/ADR-0010-RabbitMQ与Redis异步执行及Outbox-Inbox.md), [ADR-0020](../../../docs/08-架构决策/ADR-0020-第三方集成运行时与供应商适配器.md), and the [module description](../../../docs/03-模块说明/事件与可靠消息模块.md).
