# G3-WORKER-PRODUCTION-COMPOSITION

## Scope

Completed the code and deployment composition for the only reviewed asynchronous route: Task projection Outbox publication plus Task projection Inbox consumption. Production release activation remains evidence-gated and is not self-certified by repository tests.

## Known facts

- ADR-0027 owns exactly `platform.task-center.projection.v1`, the Task projection event route, 3 total consume attempts, 30/300-second fixed TTL layers, 10-second Handler deadline, prefetch 2, concurrency 1 and the stable error classifier.
- Organization and Workflow are Message components without consumer queues. Notification/File/private Job components have no reviewed `jobType`, queue, retry policy or owning Handler.
- Eventing Inbox and Task projection stores share the abortable `DatabaseRuntime`; its nested transaction context keeps Inbox receipt and projection apply in one local transaction before ACK.
- The repository RabbitMQ integration fixture uses synthetic temporary credentials/certificates. It proves client/server protocol behavior, not production image, CA, VHost, Secret rotation, recovery or alert deployment.

## Allowed assumptions used

- The already reviewed Task event route is also the only Outbox publisher route composed in this Worker.
- Outbox batch size, claim lease, maximum attempts, exact backoff vector and polling interval are mandatory typed release inputs. Their values are supplied by staging/release review and are not encoded as production defaults.
- `platform.task-center` is the stable responsibility Owner; deployment resolves the current human on-call without storing a person's identity in code.

## Forbidden assumptions preserved

- No Notification, Workflow, Organization, File or generic private-Job queue/route/handler/schedule was created.
- No local test, Compose declaration, alert YAML or code switch is treated as trusted production evidence.
- No exactly-once, SLA, capacity, automatic failover, RPO/RTO or automatic DLQ replay claim is made.
- No Secret value, message payload, SQL parameter, customer/personal data or raw error is logged or documented.

## Non-goals

- DLQ replay authorization/audit implementation, other background Job types, RabbitMQ HA, production account provisioning execution, alert-provider API calls and production-host recovery execution.
- Application-start migration or automatic schema synchronization.

## Delivered

- Production Worker composes `createRabbitConfirmTransport` + PostgreSQL Eventing Store + `createOutboxPublisher` + the Outbox loop for the single Task route.
- The same runtime composes PostgreSQL Eventing Inbox + PostgreSQL Task Center projection Store + the sealed Rabbit consumer/Handler. Worker readiness requires database compatibility/health, Publisher health and Task consumer health.
- Bootstrap registers both production handlers. Shutdown marks unavailable, cancels acquisition, drains the Inbox consumer idempotently, then closes Rabbit and PostgreSQL resources within the existing budget.
- Typed required configuration covers activation and all Outbox values; invalid retry vector length fails closed. Host B mounts the Worker DB URL, CA and separate Rabbit credentials as individual files.
- Host A disables plaintext AMQP, serves 5671 with verified TLS material, creates an isolated VHost and separate least-privilege Publisher/Consumer accounts.
- Migration `0000000014` grants the dedicated `ai_crm_worker_runtime` role only the Task Outbox/Inbox/isolation and projection relations/actions reachable from this composition, with forward-only recovery guidance.
- Alert contract and recovery procedure are recorded in `deploy/monitoring/task-projection-alerts.v1.yaml` and `docs/04-工程手册/Task投影消费者生产运行手册.md`.

## Activation boundary

- Code activation requires explicit `AI_CRM_WORKER_TASK_PROJECTION_CONSUMER_ENABLED=true`; false or missing fails before DB/Rabbit acquisition.
- Production Compose requires this value but does not hardcode it. Operators may set it true only after release-manifest evidence closes the four AsyncAPI blockers.
- AsyncAPI remains `activation.enabled: false` because trusted production TLS/image, VHost/Secret rotation, recovery/drain and deployed-alert evidence has not been supplied in this workspace. This is an external release blocker, not a reason to keep a long-term code failure factory.

## Verification

- Worker full: 16 files passed, 1 integration file skipped; 114 passed, 5 skipped. Build ran before tests.
- Worker lint and typecheck: passed.
- Focused production config/composition/Rabbit: 33/33 passed after Outbox composition.
- Database ordinary tests: 33 passed, 6 environment-gated integration tests skipped.
- RabbitMQ 4.2.9 + amqplib 2.0.1 synthetic TLS matrix: passed all CA/hostname/VHost denial, separated permission, Confirm/Return, ACK and redelivery cases; Docker resources were removed.
- `pnpm compose:check`: passed.
- `pnpm contracts:check`: 28/28 package contract checks passed.
- Final `pnpm check`: 140/140 Turbo tasks successful after repository checks, Compose checks and contract drift checks.
- `pnpm db:test:integration`: 39/39 passed against isolated PostgreSQL 17.5 containers. It proved the `0013`/`0014` role prerequisites and forward rerun, exact API/Worker allow and denial matrix, fixed Worker identity boundary, empty-database migration/idempotency, cancellation and cleanup; Docker resources were removed.

## Eight-area review

- Authorization: normal projection consumption calls only the owning Task projection boundary. DLQ replay remains disabled and ungranted.
- Idempotency: PostgreSQL Inbox plus Task event receipt/version guards handle duplicates and stale delivery; Outbox claim tokens preserve retry ownership.
- Transactions: Inbox receipt and projection apply share the same abortable local transaction; ACK happens only after resolution. Outbox publish Confirm precedes published-state update.
- Migrations: additive `0014`, no startup migration, no auto-sync; exact grants and forward recovery documented.
- Observability: readiness uses stable dependency IDs; alert dimensions are bounded; payload/Secret inspection is forbidden.
- Backward compatibility: only the accepted Task v1 route is added; other message components remain queue-free. Runtime policy changes require reviewed config/evidence.
- Secrets: AMQPS only, server verification, separate file credentials, no default VHost, individual Compose mounts and root/service-reader policy.
- Failure modes: missing/false activation, malformed Outbox policy, incompatible migration, DB loss, Rabbit Blocked/close, retry uncertainty, DLQ, startup cancellation and bounded drain all fail closed or preserve retryable facts.
