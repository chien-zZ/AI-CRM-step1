# Worker Application

NestJS composition root for RabbitMQ consumers, outbox delivery, scheduled work, file verification and ClamAV scanning, object cleanup and reconciliation, and external channel adapters. RabbitMQ carries messages and execution requests; it must not be the source of truth for approvals, files, or domain state. Redis is limited to cache and short-lived execution coordination.

It is separated from `apps/api` because retries, idempotency, locks, dead letters, throughput, and long-running execution have different operational requirements from synchronous HTTP requests.

Approved asynchronous provider adapters are composed here behind owning-module ports and the business-neutral integration runtime. The default path is local transaction, Outbox, RabbitMQ, Worker, and Adapter; every handler rechecks authoritative state before an external side effect. Provider success remains an integration result until the owning module accepts it through a formal command or event. No concrete third-party adapter is part of the first-stage scope.

Worker logs, errors, health signals, and traces use the project observability boundary. Message IDs and attempt context may correlate diagnostics, but job payloads, provider data, credentials, and business facts do not enter logs or Sentry. See [ADR-0022](../../docs/08-架构决策/ADR-0022-第一阶段轻量可观测性基线.md).

Future approved asynchronous AI adapters are composed here behind `ai-gateway` and owning-module use cases. Workers recheck use-case enablement, authoritative resource state, data policy, budget, cancellation, and expiry before a model call; late or duplicate outputs cannot directly change domain state. The first stage uses only Fake Adapter conventions and synthetic fixtures. See [ADR-0024](../../docs/08-架构决策/ADR-0024-AI网关与AI治理边界.md).

See [ADR-0003](../../docs/08-架构决策/ADR-0003-Monorepo应用与模块边界.md), [ADR-0010](../../docs/08-架构决策/ADR-0010-RabbitMQ与Redis异步执行及Outbox-Inbox.md), [ADR-0012](../../docs/08-架构决策/ADR-0012-自研文件中心与腾讯云COS对象存储.md), and [ADR-0020](../../docs/08-架构决策/ADR-0020-第三方集成运行时与供应商适配器.md).

## CMP-01 lifecycle

The Worker composition root is a NestJS application context with explicit handler registration. Startup fails closed when a required dependency is unavailable. Shutdown first marks the process as draining, aborts handler acquisition signals, invokes each handler's stop hook, and waits for in-flight executions up to the configured deadline. A deadline breach rejects shutdown with the stable `worker_drain_timeout` category; unfinished durable work must remain retryable through the owning module's Outbox/Inbox or job semantics.

`AI_CRM_WORKER_DRAIN_TIMEOUT_SECONDS` is strictly bounded and converted to milliseconds once at the process boundary. Worker readiness is an atomic, mode `0600` marker in the container `/tmp` tmpfs. The marker contains only `status` and a millisecond timestamp, is refreshed while the Worker can accept work, and is removed before drain or after a handler/dependency failure. The build copies `worker-healthcheck.mjs` to the production Compose path `dist/worker-healthcheck.mjs`; the check rejects missing, oversized, malformed, stale, or future-dated markers without exposing dependency details.
