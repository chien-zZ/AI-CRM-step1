# Eventing And Outbox

Owns the project-specific transactional Outbox/Inbox adapters, event envelope validation, RabbitMQ publication and consumption policies, retries, reconciliation, and dead-letter handling. Redis may accelerate cache and short-lived coordination but is not a durable message or idempotency source.

Domain event contracts remain transport-neutral. Domain modules use the public platform interface and contracts; they do not depend directly on RabbitMQ, Redis, or Outbox/Inbox tables.

Approved asynchronous provider calls use this module for durable transport and consumer idempotency, then pass through the owning capability port and provider adapter. `integration-runtime` does not create a second message bus or make provider delivery a domain fact.

See [ADR-0010](../../../docs/08-架构决策/ADR-0010-RabbitMQ与Redis异步执行及Outbox-Inbox.md), [ADR-0020](../../../docs/08-架构决策/ADR-0020-第三方集成运行时与供应商适配器.md), and the [module description](../../../docs/03-模块说明/事件与可靠消息模块.md).

The public API exposes database-neutral persistence and RabbitMQ confirm-channel ports. `appendEvent` must run inside the owning module's local transaction. Consumer handlers and the durable Inbox receipt commit in one local transaction; the transport may ACK only after that call returns. Redis is absent from correctness paths.

Production composition uses the official `DatabaseRuntime` instance for both the owning module and `createPostgresEventingStore`, with the owning command wrapped by `DatabaseRuntime.withTransaction`. Consumption serializes the same `messageId + consumer` inside the database transaction before checking Inbox, so concurrent redelivery returns `duplicate` after the first commit. Job consumption atomically claims `queued -> processing`; cancellation only changes `queued` jobs, and completion/isolation only changes `processing` jobs.

Every event policy and Job contract supplies an explicit bounded `timeoutMs`. On expiry the core aborts the required handler `AbortSignal`, waits for the handler to settle, and only then rolls back and releases the transaction; a timed-out Promise cannot continue using a released transaction connection. Handlers must settle when aborted. Remote effects cannot join the database transaction and therefore require a persisted recoverable state plus a stable provider idempotency key and reconciliation as required by ADR-0010; `AbortSignal` alone never proves that a remote effect stopped.

Rabbit delivery derives Job retries from the validated Job envelope. Event retries remain an explicit topology policy. Bounded observer callbacks report operation/outcome/duration/count only, never payloads or provider errors; backlog and reconciliation report missing or isolated durable facts without mutating authoritative state.

Manual Outbox replay fails closed and requires an authorization decision reference, a bounded reason, and a successfully recorded audit intent before state is changed. The module migration is additive; applied migrations are immutable and corrections use forward migrations.
