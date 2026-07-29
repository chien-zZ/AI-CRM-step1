# Worker Application

NestJS composition root for RabbitMQ consumers, outbox delivery, scheduled work, file verification and ClamAV scanning, object cleanup and reconciliation, and external channel adapters. RabbitMQ carries messages and execution requests; it must not be the source of truth for approvals, files, or domain state. Redis is limited to cache and short-lived execution coordination.

It is separated from `apps/api` because retries, idempotency, locks, dead letters, throughput, and long-running execution have different operational requirements from synchronous HTTP requests.

Approved asynchronous provider adapters are composed here behind owning-module ports and the business-neutral integration runtime. The default path is local transaction, Outbox, RabbitMQ, Worker, and Adapter; every handler rechecks authoritative state before an external side effect. Provider success remains an integration result until the owning module accepts it through a formal command or event. No concrete third-party adapter is part of the first-stage scope.

Worker logs, errors, health signals, and traces use the project observability boundary. Message IDs and attempt context may correlate diagnostics, but job payloads, provider data, credentials, and business facts do not enter logs or Sentry. See [ADR-0022](../../docs/08-架构决策/ADR-0022-第一阶段轻量可观测性基线.md).

Future approved asynchronous AI adapters are composed here behind `ai-gateway` and owning-module use cases. Workers recheck use-case enablement, authoritative resource state, data policy, budget, cancellation, and expiry before a model call; late or duplicate outputs cannot directly change domain state. The first stage uses only Fake Adapter conventions and synthetic fixtures. See [ADR-0024](../../docs/08-架构决策/ADR-0024-AI网关与AI治理边界.md).

See [ADR-0003](../../docs/08-架构决策/ADR-0003-Monorepo应用与模块边界.md), [ADR-0010](../../docs/08-架构决策/ADR-0010-RabbitMQ与Redis异步执行及Outbox-Inbox.md), [ADR-0012](../../docs/08-架构决策/ADR-0012-自研文件中心与腾讯云COS对象存储.md), [ADR-0020](../../docs/08-架构决策/ADR-0020-第三方集成运行时与供应商适配器.md), and [ADR-0026](../../docs/08-架构决策/ADR-0026-RabbitMQ运行策略与延迟重试边界.md).

## CMP-01 lifecycle

The Worker composition root is a NestJS application context with explicit handler registration. Startup fails closed when a required dependency is unavailable. Shutdown first marks the process as draining, aborts handler acquisition signals, invokes each handler's stop hook, and waits for in-flight executions up to the configured deadline. A deadline breach rejects shutdown with the stable `worker_drain_timeout` category; unfinished durable work must remain retryable through the owning module's Outbox/Inbox or job semantics.

`AI_CRM_WORKER_DRAIN_TIMEOUT_SECONDS` is strictly bounded and converted to milliseconds once at the process boundary. Worker readiness is an atomic, mode `0600` marker in the container `/tmp` tmpfs. The marker contains only `status` and a millisecond timestamp, is refreshed while the Worker can accept work, and is removed before drain or after a handler/dependency failure. The build copies `worker-healthcheck.mjs` to the production Compose path `dist/worker-healthcheck.mjs`; the check rejects missing, oversized, malformed, stale, or future-dated markers without exposing dependency details.

The executable entry point is `dist/main.js` (`pnpm --filter @ai-crm/worker start`). It loads typed runtime configuration, creates the project Pino boundary, and returns the process exit code only after startup failure or graceful/fatal shutdown has settled. If any handler resolves or rejects after readiness, the first termination wins, readiness is removed, acquisition is aborted, every handler is stopped once, in-flight work is drained within the deadline, and bootstrap returns exit code `1`. Handler IDs are bounded stable telemetry dimensions and are validated, including uniqueness, before any event is written.

## Composition boundary

Known facts:

- No production consumer has passed ADR-0026's activation gate. A contract binding or installed client does not by itself authorize consumption.
- The platform packages expose `OutboxPublisher`, Rabbit confirm/delivery ports, durable `EventingCore.consume`, File Center maintenance commands, Task Center reconciliation, and Notification intent submission through their package roots.

Allowed assumptions:

- CMP-01 may register those public capabilities through explicit application-owned adapters and a sealed handler registry.
- The concrete Rabbit adapter reports the exact reviewed binding IDs and keeps its `run` promise pending until acquisition stops.

Forbidden assumptions:

- Do not invent event/job types, exchanges, queues, routing keys, retry policies, schedules, actors, commands, provider credentials, or CRM rules in this application.
- Do not import module repositories, schemas, database rows, Rabbit client types, or provider SDKs. Do not use the registry as a runtime Service Locator.

Non-goals:

- This slice does not supply or activate production RabbitMQ topology/policy values, create a real scanner/provider adapter, schedule an unconfirmed reconciliation cadence, replay a DLQ, or run migrations at startup.

`createOutboxPublisherLoopHandler` drives the public Publisher. `createRabbitInboxHandler` connects an application-owned consumer adapter to the public Rabbit delivery wrapper and durable Inbox consumption. The adapter must expose its actual stable binding-ID set, bounded prefetch/concurrency, acquisition stop and in-flight drain operations; the sealed registrations must match that set exactly before readiness. No caller-supplied count or boolean can assert production readiness. Production registers only the reviewed Task projection route and binding. File, Notification, Workflow and other Message/Job components create no queue or handler without their own reviewed ownership and topology.

The production composition loads the Worker PostgreSQL URL only through `AI_CRM_POSTGRES_URL_FILE`, checks the complete reviewed migration catalog without applying migrations, and maintains a bounded runtime database-health cache. It opens separate TLS Publisher and Task-consumer resources, declares exactly the ADR-0027 topology, and composes the PostgreSQL Eventing Outbox/Inbox plus Task projection stores through one abortable Database Runtime. Database loss, broker Blocked, and channel/connection close fail readiness closed.

The approved migration-root manifest is checked bidirectionally against `packages/database/migrations` and every discovered `packages/platform-modules/*/migrations` directory. Adding or removing a migration-owning package therefore fails Worker production configuration until the reviewed manifest is updated. Rabbit acquisition cancellation reaches connector/model/Channel creation; a model obtained before a stuck Channel creation is force-closed. Resource close calls share one in-progress close, can continue waiting after an application timeout, and retry only targets whose close explicitly failed.

Production bootstrap requires an explicit typed `AI_CRM_WORKER_TASK_PROJECTION_CONSUMER_ENABLED=true`, migration compatibility, initial database health, AMQPS files/VHost, exact topology and both Task Outbox Publisher and Inbox Consumer handlers before becoming Ready. ADR-0027 seals three total consume attempts, 30/300-second fixed TTL layers, a 10-second Handler deadline, prefetch 2 and concurrency 1. Unknown or forged error-shaped values are terminal. Outbox batch, lease, retry/backoff and interval values are mandatory reviewed release inputs rather than repository defaults.

Code-level activation is available, but release remains blocked while AsyncAPI `activation.enabled` is false and trusted environment evidence is absent. The local RabbitMQ fixture is synthetic compatibility evidence, not production TLS, Secret rotation, recovery or deployed-alert proof. Release-manifest gates and `Task投影消费者生产运行手册.md` require those external evidence references before operators set the activation input to true. Startup never applies migrations.

The application exposes the Task projection consumer composition and production bootstrap registers it only behind the explicit activation input. `createTaskProjectionMessageHandler` accepts only the reviewed `task-center.projection-lifecycle.v1` envelope/schema and exact v1 data shape, converts it to the business-neutral `TaskLifecycleEvent`, and passes the Eventing Core's `AbortSignal` unchanged to an injected `AbortableTaskProjectionApplyPort`. `createTaskProjectionConsumerHandler` binds that handler only to the sealed ADR-0027 consumer ID, binding ID, retry classifier, timeout, prefetch, and concurrency; a concrete adapter with different runtime values is rejected. Duplicate detection and the ACK boundary remain owned by the durable Eventing Inbox transaction.

The additive Rabbit adapter uses exact `amqplib@2.0.1`, whose package declares Node.js `>=18`, includes its own TypeScript declarations, and documents RabbitMQ 4.1+ compatibility for client versions 0.10.7 and later. Do not install `@types/amqplib` beside this version. Upgrades must repeat the TLS, Confirm/Return, backpressure, cancellation, and drain matrix.

`loadRabbitConnectionConfiguration(role)` accepts only AMQPS. Host, port, server name, heartbeat, and a non-default VHost are non-secret configuration. The selected publisher or consumer username/password and the CA are read only from absolute `*_FILE` paths. Production files must be root-owned; owner-only `0400`/`0600` and root-to-service-reader `0440`/`0640` layouts are accepted, while group write/execute and every `other` permission fail closed. Optional client certificate and key files must appear together. Empty/unreadable files, malformed TLS material, disabled verification, missing server-name verification, and the default VHost also fail closed. The loader never accepts a credential value environment variable or an AMQP URL. Publisher and consumer roles use distinct file variable names so a later composition can mount least-privilege service Secrets independently.

The publisher adapter implements the platform Confirm Channel port with durable exchanges, Mandatory persistent publication, per-publication callback confirmation, and a fresh private transport-publication Header echoed by Basic.Return. Return correlation therefore never guesses from the stable message ID, including when multiple outstanding publications reuse it and a later Return arrives before confirm callbacks. The private Header is overwritten on every publish and is rebuilt rather than copied from inbound delivery metadata. The adapter also enforces write-buffer Drain and close/Confirm uncertainty rejection. The consumer adapter owns a frozen deep copy of caller-supplied reviewed durable topology, including queue-level fixed TTL retry layers, applies explicit prefetch and application concurrency limits, validates bounded technical retry properties, manually ACKs/NACKs through the vendor-neutral delivery wrapper, cancels acquisition before bounded in-flight drain, and becomes unavailable on Blocked, main/retry channel or connection close, broker cancellation, or uncertain retry publication. `AbortableRabbitConsumerAdapter.drain(signal)` and publisher `close(signal)` let the composition deadline force resource closure; normal close failures are reported rather than hidden. It never automatically replays a DLQ.
