# WORKER-TASK-PROJECTION-01

## Scope

Implemented the business-neutral Worker composition for the reviewed Task projection lifecycle consumer. Production activation remains disabled.

## Known facts

- ADR-0027 seals consumer/binding identity, topology, three total attempts, 30/300-second retry layers, 10-second timeout, prefetch 2, concurrency 1, and stable error classification.
- Eventing Core owns envelope validation, durable Inbox deduplication, handler timeout signal creation, Inbox/projection transaction completion, and consumption result.
- Rabbit delivery ACK/retry/DLQ behavior is owned by the public Eventing delivery wrapper.
- The existing production bootstrap still fails closed with `task_projection_consumer_policy_unavailable`.

## Allowed assumptions used

- An application-owned `AbortableTaskProjectionApplyPort.apply(event, signal)` may adapt a reviewed Task Center persistence API without exposing its repository or transaction handle.
- The Worker may strictly parse the reviewed Task projection v1 data contract before calling that port.
- Composition may be exported for tests and later explicit activation without being registered in production bootstrap.

## Forbidden assumptions preserved

- No Promise race is treated as database cancellation; the Eventing Core signal is passed unchanged and the apply promise is awaited to settlement.
- No production consumer, topology declaration, environment-tunable policy, CRM event, schedule, account, Secret, or provider is introduced.
- No Rabbit/PostgreSQL evidence gate or AsyncAPI `activation.enabled: false` state is bypassed.

## Non-goals

- Task Center repository or PostgreSQL implementation changes.
- Production Secret/Compose wiring, migration execution, alert configuration, DLQ replay, capacity claims, or CRM behavior.

## Delivered

- `task-projection-composition.ts` provides strict v1 parsing, an abortable MessageHandler factory, and a Rabbit Inbox consumer factory wired only to the sealed policy/classifier.
- The consumer factory rejects concrete adapters whose prefetch or concurrency differs from ADR-0027.
- Tests cover successful conversion, schema/additional-field rejection, AbortSignal identity and settlement, reviewed retry classification/delay/ACK ordering, unknown-error DLQ behavior, policy mismatch, and invalid port rejection.
- The package public entry point and Worker README document the inactive boundary.

## Verification

- `pnpm --filter @ai-crm/worker lint`: passed.
- `pnpm --filter @ai-crm/worker typecheck`: passed.
- `pnpm --filter @ai-crm/worker test`: passed, 13 files and 98 tests.

## Eight-dimension review

- Authorization: no user/business command is accepted; consumer activation still requires reviewed operational authority and evidence.
- Idempotency: no second mechanism was added; Eventing Inbox remains authoritative and Task projection stale/version guards remain downstream.
- Transactions: ACK occurs only after `EventingCore.consume` resolves; Worker does not expose or split transaction handles.
- Migrations: none added or applied; startup migration behavior is unchanged.
- Observability: no payload or unbounded field logging was added; existing stable handler/binding dimensions remain in use.
- Backward compatibility: additive exports only; event type/schema/version and runtime policy are exact and versioned.
- Secrets: no Secret values, variables, files, credentials, or provider configuration were added.
- Failure behavior: malformed input and unknown failures are terminal; only sealed retryable errors enter reviewed delay layers; abort reaches the apply port and is not represented as completed until the port settles.

## Remaining activation blockers

- The exported port is structurally compatible with the reviewed Task Center abortable apply boundary; production bootstrap composition remains intentionally absent.
- Real RabbitMQ TLS/minimum-permission/Confirm/Return/ACK/redelivery and PostgreSQL projection cancellation evidence passed in the combined wave. Production account/CA/VHost/Secret ownership, fixed retry/DLQ recovery drills, alert Owner/Runbook, and production composition are still unresolved.
- Only after those gates may AsyncAPI activation and production bootstrap behavior be changed in a separate reviewed task.
