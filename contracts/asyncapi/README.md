# AsyncAPI

Machine-readable asynchronous API definitions generated from or linked to the event contract sources.

RabbitMQ channels, exchanges, queues, bindings, routing keys, delivery guarantees and dead-letter policies are declared here and reference transport-neutral schemas from `contracts/events/`. Generated bundles must not be edited manually.

`topology.asyncapi.yaml` declares reusable message components for every currently reviewed platform event schema and the private Worker Job envelope. A message component is not a subscription: a durable queue is added only when its owning consumer, handler contract and runtime policy have been reviewed.

The current declared slice is `task-center.projection-lifecycle.v1` into the Task Center projection. It defines a durable topic exchange and queue, publisher confirms plus mandatory publication, manual acknowledgement after the local Inbox transaction, and a terminal dead-letter exchange and queue. ADR-0027 fixes the first policy at three total attempts, 30/300-second fixed queue-level TTL delay layers, a 10-second handler deadline, prefetch 2 and concurrency 1. Unknown errors are terminal. Retry is limited to stable Task storage, Eventing storage, retryable Inbox conflict, and handler-timeout codes that also explicitly carry `retryable=true`. These values are a conservative safety baseline, not an SLA or capacity claim.

Consumer activation remains blocked until real RabbitMQ TLS, least-privilege VHost/Secret, Inbox/retry/DLQ recovery, and alert/Runbook evidence exists. The reviewed values authorize implementation and testing, not production activation. A shared retry queue with variable per-message TTL remains forbidden because RabbitMQ only expires messages at the queue head and could delay shorter retries behind longer ones.

Every consumed delivery requires `x-ai-crm-delivery-attempt`. Initial publication sets `1`; a confirmed retry publication changes attempt `N` to `N + 1`; dead-letter routing preserves it. Retry attempt `N` uses `backoffSeconds[N - 1]` and is permitted only while `N < maxAttempts`. The Outbox publication attempt is a separate fact and cannot substitute for delivery attempt.

The RabbitMQ VHost is an environment-isolated, non-secret application runtime setting. The contract intentionally does not hardcode `/` or another VHost name, and implicit/default VHost use is forbidden.

Organization and Workflow lifecycle events remain reusable Message components without queues because no consumer/translation contract is yet accepted. The private Job envelope likewise has no channel until a concrete `jobType`, owning handler and queue policy are reviewed. This fail-closed distinction prevents a schema from silently creating a competing consumer or acknowledging work with no owner.

See [ADR-0010](../../docs/08-架构决策/ADR-0010-RabbitMQ与Redis异步执行及Outbox-Inbox.md).
See [ADR-0027](../../docs/08-架构决策/ADR-0027-Task投影消费者首版运行策略.md).
