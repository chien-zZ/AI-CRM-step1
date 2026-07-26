# Worker Job Contracts

Private Worker job payload schemas delivered through RabbitMQ. These execution contracts may reference retry, timeout, concurrency and dead-letter policies, and must not be reused as transport-neutral domain event schemas.

Reminder, reconciliation, and retry jobs are execution mechanisms. Their completion must not be treated as approval or domain-state truth, and Flowable or RabbitMQ payloads must not leak into public workflow contracts. Every job requires a deterministic idempotency key and must recheck its authoritative source state before producing side effects.

See [ADR-0010](../../docs/08-架构决策/ADR-0010-RabbitMQ与Redis异步执行及Outbox-Inbox.md).

`job-envelope.v1.schema.json` defines the private v1 execution envelope. Each request declares bounded retry, timeout, failure disposition, idempotency, and authoritative-state recheck context.
