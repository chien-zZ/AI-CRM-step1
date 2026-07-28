# ASYNC-RABBIT-ADAPTER-01 RabbitMQ Application Adapter

## Objective

Implement the application-owned `amqplib` adapter for the existing vendor-neutral eventing ports, covering secure connection/configuration, confirms and mandatory returns, backpressure, manual consumer settlement, bounded retry/DLQ routing, readiness, cancellation, drain, and stop without enabling a production consumer.

## Known Facts

- ADR-0026 is accepted and RabbitMQ `4.2.9` is the current validation target, not yet a production image approval.
- The repository requires Node.js 24 and exposes vendor-neutral `RabbitConfirmChannel`, `RabbitDelivery`, and `RabbitConsumerAdapter` ports.
- No reviewed production consumer policy values or complete production topology are available; current production bootstrap must remain fail-closed.
- Production credentials, CA, client certificate, and private key are file Secrets; the VHost is explicit non-secret configuration.
- RabbitMQ provides at-least-once delivery. PostgreSQL Outbox/Inbox remains the durable correctness boundary.

## Allowed Assumptions

- A stable maintained `amqplib` release may be selected after read-only registry/package evidence confirms its Node 24 support and AMQP 0-9-1 compatibility with RabbitMQ 4.2.
- Unit tests may use typed fake connections/channels and synthetic, non-domain bindings.
- Non-production protocol integration may use an already-running repository RabbitMQ only when it requires no deployment or contract changes and does not weaken the production TLS gate.

## Forbidden Assumptions

- Do not invent Task Center or other consumer retry counts, delays, timeout, prefetch, concurrency, topology, owners, permissions, or alert thresholds.
- Do not treat a successful connection or topology assertion as approval to activate production consumers.
- Do not add default RabbitMQ accounts, URLs, VHosts, credentials, certificate paths, queue names, or permissive TLS behavior.
- Do not promise exactly-once delivery, automatic failover, SLA, RPO, or RTO.

## Non-goals

- No production consumer activation or production composition-root wiring.
- No AsyncAPI/topology contract changes, RabbitMQ deployment changes, migrations, domain handlers, replay UI, or management API integration.
- No modification of the root lockfile and no real Secret values.

## Authority And References

- Repository `AGENTS.md` instructions supplied in the current task.
- `docs/08-架构决策/ADR-0026-RabbitMQ运行策略与延迟重试边界.md`.
- `docs/08-架构决策/ADR-0010-RabbitMQ与Redis异步执行及Outbox-Inbox.md`.
- `docs/04-工程手册/第一阶段AI并行开发实施计划.md`.
- Public exports of `@ai-crm/platform-eventing-outbox` and the current Worker lifecycle/handler ports.
- npm registry metadata and upstream `amqplib` package documentation, captured read-only in this handoff.

## Allowed Paths

- `apps/worker/src/**` for Rabbit adapter/configuration/tests and related public exports.
- `apps/worker/package.json` for exact direct dependency versions.
- `apps/worker/README.md` for operator/developer documentation.
- `.handoffs/ASYNC-RABBIT-ADAPTER-01.md`.

## Forbidden Paths

- Root `pnpm-lock.yaml` or any other lockfile.
- `contracts/asyncapi/**`, all other `contracts/**`.
- Other `apps/**`, `packages/**`, `deploy/**`, existing `.handoffs/**`, and generated `dist/**`/coverage artifacts.

## Contract Changes

None. The adapter implements existing vendor-neutral ports. New application-local configuration/types may be exported from `@ai-crm/worker`; no HTTP, event, job, or AsyncAPI contract changes are permitted.

## Migration Changes

None.

## Dependencies

- Select exact `amqplib` and matching TypeScript type package versions using npm registry evidence.
- Existing `@ai-crm/platform-eventing-outbox` public interfaces.
- Reviewed binding/topology input supplied by a future composition task; this task supplies no production values.

## Required Tests

- File Secret missing, unreadable, empty, newline handling, and over-permissive file mode fail closed.
- Production TLS/VHost/account configuration rejects absent/default/unsafe values and never falls back to environment Secret values.
- Confirm and mandatory Return correlation, concurrent publishes, channel/connection close rejection, and write-buffer drain behavior.
- Manual ACK, retry publish-confirm-before-ACK, failed/uncertain retry leaves the original unacknowledged, terminal DLQ rejection, prefetch/concurrency limits.
- Blocked/close/cancel readiness transitions; acquisition cancellation; bounded in-flight drain and idempotent stop.
- Production bootstrap remains unavailable without reviewed composition.

## Authorization And Audit

- This adapter performs no administrative replay and grants no permission. DLQ replay remains disabled pending its separate authorization/audit contract.
- Broker settlement and technical readiness are not audit facts and do not prove business completion.

## Idempotency, Retry And Failure

- Mandatory publish uses stable message IDs, per-message confirm/return correlation, persistent messages, and backpressure drain.
- Consumer ACK occurs only after the vendor-neutral handler returns or retry publication is confirmed and not returned.
- Publish/confirm/close uncertainty rejects the operation; the original delivery remains unacknowledged for broker redelivery.
- Terminal or exhausted work uses `nack/reject(requeue=false)` into the reviewed DLX; no immediate requeue loop or automatic replay.

## Observability And Health

- Readiness requires an open, unblocked TLS connection, open required channels, successful topology assertions, and active consumers when configured.
- Blocked, connection/channel close, broker cancellation, stop, or drain makes the adapter not ready and stops new acquisition.
- Errors and health state expose only stable categories; no URL, VHost, username, Secret path/value, queue name, payload, arbitrary headers, or raw provider error is logged or returned.

## Backward Compatibility

- Existing Worker handlers and vendor-neutral platform ports remain unchanged.
- The concrete adapter is additive and unused by the production bootstrap until a later reviewed composition change.
- Exact client upgrades require repeating the ADR-0026 compatibility matrix.

## Deliverables

- Registry compatibility evidence and exact dependencies in `apps/worker/package.json`.
- Typed file-based RabbitMQ connection configuration.
- Concrete publisher confirm channel and consumer adapter.
- Layered unit tests and optional safe non-TLS local protocol integration evidence.
- Updated Worker README and completed handoff results.

## Unresolved Questions

- Production RabbitMQ image digest and upgrade owner.
- Production CA issuance, optional mutual TLS decision, VHost/account names, Secret owners, and rotation period.
- Every consumer's exact topology, retry policy, timeout, prefetch/concurrency, handler/owner, and replay authorization.
- Whether a later integration task will provide a dedicated TLS RabbitMQ test fixture.

## Handoff Result

Implemented inside the allowed Worker boundary. No production consumer is enabled and no unresolved policy/topology value is encoded.

### Registry And Compatibility Evidence

Read-only npm registry queries were executed on 2026-07-28:

- `npm view amqplib version engines dist-tags time --json` reported `latest = 2.0.1`, `engines.node = >=18`, and publication time `2026-05-10T15:40:48.816Z`.
- `npm view amqplib@2.0.1 name version engines types main exports dependencies repository --json` reported built-in declarations at `./index.d.ts`, typed package exports, no runtime dependencies, and the upstream `amqp-node/amqplib` repository.
- The `amqplib@2.0.1` registry README states that only `0.10.7` and later are compatible with RabbitMQ `4.1.0` and later. Therefore `2.0.1` covers the ADR-0026 RabbitMQ `4.2.9` validation target and declares support for the repository's Node.js 24 runtime.
- `npm view @types/amqplib version ... --json` reported `0.10.8`, but it was intentionally not installed: runtime package `2.0.1` owns its declarations, and ADR-0026 forbids a conflicting second type source.
- `apps/worker/package.json` pins `amqplib` exactly to `2.0.1`. The root lockfile remains untouched by instruction; the Integration Owner must update and review it before merge.

### Implementation

- `rabbit-config.ts` loads publisher or consumer account files, password files, CA, and optional paired client certificate/key from absolute restricted files. AMQPS, server-name and CA verification, explicit non-default VHost, bounded heartbeat/port, TLS material parsing, and production root ownership fail closed. Plaintext credential environment values and AMQP URLs are not supported.
- `rabbit-adapter.ts` adds an `amqplib` Confirm Channel adapter behind the existing vendor-neutral port. It enforces Mandatory persistent publishes, message-ID Return correlation, write-buffer Drain, and rejects closed/uncertain confirms.
- The consumer adapter accepts only explicit caller-supplied topology and limits, asserts durable main/DLQ/fixed queue-level TTL retry entities, uses manual ACK/NACK, confirms a retry before the original can be ACKed, stops on Blocked/close/cancel, bounds handler concurrency separately from prefetch, cancels acquisition, drains active work, and closes resources.
- Retry publication copies only controlled technical headers plus bounded `appId`, `correlationId`, and `type`; it does not copy arbitrary original headers or payloads into observability.
- Worker public exports and README are updated. Production bootstrap is not wired to the adapter and remains unavailable.

### Verification

- `pnpm --filter @ai-crm/worker typecheck`: passed.
- ESLint on the four new implementation/test files: passed with zero warnings.
- `pnpm --filter @ai-crm/worker test`: 8 files / 72 tests passed after the review loop, including the existing production-bootstrap fail-closed child test.
- `pnpm --filter @ai-crm/worker contracts:check`: passed.

### Independent Eight-Dimension Review

1. **Authorization and audit:** the adapter exposes no broker administration or replay operation and grants no application permission. DLQ replay remains unavailable. Transport settlement is not misrepresented as an audit fact.
2. **Idempotency and duplicate delivery:** stable message IDs are retained; ACK loss and uncertain confirms remain at-least-once. No exactly-once claim or Inbox bypass was introduced.
3. **Transactions and settlement order:** the adapter does not own a database transaction. The existing neutral handler returns only after Inbox/local transaction commit; retry Confirm plus non-Return completes before original ACK. Retry uncertainty leaves the original unacknowledged.
4. **Migration and data ownership:** no database/schema/migration change exists and no module table/type/query builder crosses the application boundary.
5. **Failure, retry, and shutdown:** unknown retry layers fail closed; no immediate requeue or automatic DLQ replay exists; Blocked/close/cancel stops acquisition; manual terminal NACK uses `requeue=false`; stop cancels then drains before resource close.
6. **Observability and privacy:** the adapter emits no raw error, URL, VHost, queue, Secret path/value, payload, or arbitrary Header to logs/health. Readiness is a bounded boolean consumed by the existing Worker lifecycle.
7. **Secrets and transport security:** AMQPS, CA validation, hostname verification, absolute file references, restricted permission bits, production root ownership, non-empty values, optional paired mTLS material, explicit VHost, and role-specific files are enforced. There is no credential env-value fallback or disabled verification path.
8. **Backward compatibility and activation:** public platform ports/contracts are unchanged; application exports are additive; built-in `amqplib` types avoid duplicate declarations; no production topology/policy/consumer was added; existing production bootstrap fail-closed test passes.

### Remaining Integration Gates

- Integration Owner: update the root `pnpm-lock.yaml` for exact `amqplib@2.0.1` and run the full repository gate.
- Integration/CI Owner: provide a reviewed RabbitMQ `4.2.9` TLS fixture with role-separated least-privilege accounts to prove real certificate/hostname failure, VHost/permission denial, concurrent Confirm/Return ordering, broker resource Blocked behavior, restart/redelivery, fixed TTL/DLX timing, cancellation, and drain. No current shared fixture satisfies this without out-of-scope changes.
- Contract/consumer Owners: supply reviewed AsyncAPI topology and exact handler policy/limits before a later composition change. Until then production consumption remains disabled.

### Independent Review Loop

The original implementation received a separate adapter review and was corrected before handoff closure:

1. Secret modes now support the production `root:service-reader` `0440` mount while continuing to reject non-root production ownership, group write/execute, and every `other` bit.
2. Confirm/Return state is per publication and driven by the `amqplib` publish callback plus a fresh private transport-publication UUID Header that Basic.Return echoes. The former global returned-ID set/global confirm wait and all message-ID inference were removed. Regression coverage proves a Return for the second of two outstanding same-message-ID publications can arrive before either confirm callback and still classify only the second operation. Retry publication reconstructs and overwrites this private Header instead of accepting an inbound value.
3. Retry Confirm Channel close/error is a fatal consumer dependency transition: readiness fails, acquisition is cancelled, and the active run rejects.
4. Normal drain/close propagates close failures. The additive `AbortableRabbitConsumerAdapter.drain(signal)` and publisher `close(signal)` accept an upper deadline/abort while preserving the existing no-argument `RabbitConsumerAdapter` call shape; abort marks unavailable and forces channel/model closure.
5. Retry metadata is reconstructed from a strict bounded allowlist. Message/correlation/causation IDs, source, message type, kind/version, attempt, Traceparent, and Tracestate are validated; malformed or unbounded values fail before retry publication.
6. Consumer topology is copied and frozen recursively before assertion or runtime use, so caller mutation cannot change binding IDs, queue selection, or retry delays.

Review-loop verification adds production `0440`, group-execute rejection, same-ID out-of-order mixed Return, private Header reconstruction, overlong message type rejection, idle retry-channel failure, malformed Header, abort/forced-close, close-failure, and external-topology-mutation tests. The final complete Worker count is recorded in Verification.

### Integration review hardening (2026-07-28)

A later independent integration review found that a broker NACK left its claimed operation in the Confirm queue. A retry using the same stable message ID could then consume that stale operation before checking the retry's private publication Return. Failed confirmations now remove the exact claimed operation before returning the stable uncertain error. A NACK followed by a same-ID Mandatory Return regression proves the retry remains classified as unroutable. Rabbit adapter tests pass 20/20; production consumers remain disabled.
