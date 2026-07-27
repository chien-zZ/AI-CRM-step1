# CMP-01 AsyncAPI Production Topology Contract

## Objective

Define the reviewed RabbitMQ contract needed by the business-neutral Task Center projection while exposing already accepted event and Job schemas as reusable AsyncAPI Message components.

## Known Facts

- ADR-0010 accepts RabbitMQ with at-least-once delivery, PostgreSQL Outbox/Inbox durability, publisher confirms, manual consumer acknowledgement, bounded retry and dead-letter isolation.
- Event schemas are transport-neutral and Worker Job payloads are private execution contracts.
- The Task Center owns a replayable, version-aware projection and accepts `task-projection-lifecycle.v1` data.
- Organization, Workflow process and Workflow task event schemas exist, but their production consumer/translation ownership is not accepted.
- `job-envelope.v1` is an envelope, not a concrete `jobType` or handler registration.

## Allowed Assumptions

- Business-neutral RabbitMQ entity names under the `ai-crm.platform` namespace can be versioned in this contract.
- The Task Center projection consumer may use a durable queue with bounded application-selected prefetch and an explicit event runtime retry policy.
- A non-secret, environment-isolated RabbitMQ VHost is supplied by application runtime configuration; this task does not choose its environment names.

## Forbidden Assumptions

- No CRM event, Job, queue, route, schedule, SLA, retry count, delay duration, capacity, retention period or alert threshold is inferred.
- No queue is created merely because a JSON Schema exists.
- No global order, exactly-once processing, distributed transaction or automatic replay is promised.
- RabbitMQ or a dead-letter queue is not a business fact source.
- No credentials, provider payloads, message bodies or personal data enter logs or this contract.

## Non-goals

- This task does not select a Node RabbitMQ client, compose Worker handlers, edit Compose, set production capacity, or implement operational replay UI/API.
- Organization and Workflow event consumers, Workflow-to-Task projection transformation and concrete Worker Job types remain outside this change.

## Authority And References

- `AGENTS.md`
- `docs/08-架构决策/ADR-0010-RabbitMQ与Redis异步执行及Outbox-Inbox.md`
- `.handoffs/ASY-01.md`
- `.handoffs/PRC-02.md`
- `contracts/events/*.schema.json`
- `contracts/jobs/job-envelope.v1.schema.json`

## Allowed Paths

- `contracts/asyncapi/**`
- `.handoffs/CMP-01-ASYNCAPI.md`

## Forbidden Paths

- Generated contract bundles and API clients
- `apps/worker/**`, Compose/deployment files, package manifests and lockfiles
- Event and Job source schemas

## Contract Changes

- AsyncAPI version advances from `0.1.0` to `0.2.0`.
- Adds Message components for Organization change, Workflow process/task lifecycle, Task projection lifecycle and private Worker Job v1 contracts.
- Adds the Task Center projection primary and dead-letter channels and send/receive operations.
- Records confirms, mandatory publish, manual ACK, normative delivery-attempt handling, terminal isolation, disabled retry activation/replay and safe observability semantics.

## Migration Changes

None. RabbitMQ topology is declared idempotently by the future application adapter; no PostgreSQL migration or automatic database synchronization is introduced.

## Dependencies

- Worker composition must consume this source contract without deep imports.
- The RabbitMQ adapter must atomically compare declared bindings with the sealed Handler Registry before readiness and refuse activation while retry policy values or the delay mechanism remain unresolved.
- Production configuration must provide least-privilege TLS credentials through typed file references.

## Required Tests

- Parse every AsyncAPI source through `@asyncapi/parser` using the repository contract generator.
- Resolve every external Event/Job JSON Schema reference.
- Assert the primary/dead routes, durable exchanges/queues, blocked retry activation, attempt rules and no-route status of unowned Message components.
- Run repository contract checks without modifying generated artifacts.

## Authorization And Audit

Normal Task projection consumption has no user authority of its own and invokes only the owning Task Center projection boundary. Dead-letter replay is disabled because no distinct permission/audit contract is accepted. The existing `outbox_replay` operation cannot authorize a different DLQ fact.

## Idempotency, Retry And Failure

- Stable event ID plus consumer is the durable Inbox key; duplicates are expected.
- The source version guards stale Task projection updates; no global ordering is promised.
- Every consumed delivery requires attempt header `N`. Initial publication sets `1`; a confirmed retry publication sets `N + 1`; DLX preserves it; retry `N` maps to `backoffSeconds[N - 1]` and is allowed only when `N < maxAttempts`. Outbox publish attempt is independent.
- Retry activation is blocked until both concrete event policy values and a RabbitMQ delay mechanism are reviewed. A single variable per-message TTL queue is rejected because queue-head expiration can delay shorter retries behind longer ones.
- Terminal and exhausted deliveries enter the durable dead-letter queue. Replay is disabled pending a reviewed authorization/audit contract and must never become automatic.

## Observability And Health

Readiness requires declared topology, live RabbitMQ connectivity and an exact Handler Registry/binding match. Metrics cover connection, publish failure, retry, dead letter, consumer latency and Inbox duplicates. Telemetry includes only bounded technical identifiers and excludes payloads, credentials, tokens, personal data and provider payloads.

## Backward Compatibility

The prior AsyncAPI had no channels or operations. This is additive for message schemas and establishes the first routed v1 channel. Event and Job source schemas are unchanged.

## Deliverables

- `contracts/asyncapi/topology.asyncapi.yaml`
- `contracts/asyncapi/README.md`
- `contracts/asyncapi/topology.contract.test.mjs`
- This handoff with focused validation evidence

## Unresolved Questions

- Organization and Workflow consumer owners, transformations and event runtime policies remain unconfirmed.
- Concrete Worker `jobType` values, handlers, queue policies and delayed execution routes remain unconfirmed.
- RabbitMQ client library, versions, capacity, retention, environment-specific VHost names, certificate rotation and alert thresholds remain CMP-01/OPS decisions.
- Task projection retry policy values and fixed delay tiers versus another RabbitMQ delay mechanism must be accepted before the consumer can be enabled.
- The operational replay API/UI and its final permission declaration remain unconfirmed.

## Handoff Result

Implemented the business-neutral Task Center projection topology and reusable Message components within the allowed paths.

Focused verification passed:

- `node --test contracts/asyncapi/topology.contract.test.mjs`: 4/4 passed.
- `@asyncapi/parser`, supplied the absolute AsyncAPI source path, resolved all nine document-relative Event/Job references with no severity-0 diagnostic.
- Focused assertions verified the two operations, primary/dead exchange and queue pairs, blocked retry activation, normative attempt rules, environment-configured VHost and absence of unowned queues.
- Ajv 2020 validated a synthetic Task projection envelope against the combined envelope/data contracts and rejected a mismatched event type and URL-shaped deep link.
- `git diff --check` passed for the owned files.

Repository `pnpm contracts:check` currently fails because `scripts/contracts/generate.mjs` passes only the AsyncAPI source text to Parser. Document-relative references therefore resolve from the process CWD instead of the source document. The Integration Owner must change the parser call to `parse(source, { source: path })`, then run the single generation window after all contract sources stabilize. This shared script is outside this task's owned paths and was not edited.

Implementer review:

- Authorization: normal projection consumption crosses only the Task Center public boundary; DLQ replay is disabled until a distinct permission/audit contract exists.
- Idempotency: at-least-once delivery, durable Inbox identity and source-version stale protection are explicit.
- Transactions: ACK occurs only after the local Inbox transaction; when retry is later enabled, retry publication must be confirmed before ACK. No RabbitMQ/database distributed transaction is claimed.
- Migrations: none; topology declaration is independent of PostgreSQL schema synchronization.
- Observability: only bounded technical identifiers are allowed; payload, credential, token, personal-data and provider-payload logging is forbidden.
- Backward compatibility: the previously empty topology gains one additive v1 routed slice; source Event/Job schemas are unchanged.
- Secrets: only least-privilege file-reference injection is allowed; no secret value or endpoint credential was added.
- Failure modes: mandatory returns, duplicate/out-of-order delivery, blocked unsafe retry activation, terminal/exhausted isolation, disabled automatic replay and dependency readiness are explicit.
