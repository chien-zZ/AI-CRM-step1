# AsyncAPI

Machine-readable asynchronous API definitions generated from or linked to the event contract sources.

RabbitMQ channels, exchanges, queues, bindings, routing keys, delivery guarantees and dead-letter policies are declared here and reference transport-neutral schemas from `contracts/events/`. Generated bundles must not be edited manually.

`topology.asyncapi.yaml` declares reusable message components for every currently reviewed platform event schema and the private Worker Job envelope. A message component is not a subscription: a durable queue is added only when its owning consumer, handler contract and runtime policy have been reviewed.

The current declared slice is `task-center.projection-lifecycle.v1` into the Task Center projection. It defines a durable topic exchange and queue, publisher confirms plus mandatory publication, manual acknowledgement after the local Inbox transaction, and a terminal dead-letter exchange and queue. Consumer activation remains blocked until the event runtime policy values and RabbitMQ delay mechanism are reviewed. In particular, one shared retry queue with variable per-message TTL is not declared because RabbitMQ only expires messages at the queue head and would silently delay shorter retries behind longer ones. Fixed reviewed delay tiers or another accepted mechanism must be contracted before retry consumption is enabled.

Every consumed delivery requires `x-ai-crm-delivery-attempt`. Initial publication sets `1`; a confirmed retry publication changes attempt `N` to `N + 1`; dead-letter routing preserves it. Retry attempt `N` uses `backoffSeconds[N - 1]` and is permitted only while `N < maxAttempts`. The Outbox publication attempt is a separate fact and cannot substitute for delivery attempt.

The RabbitMQ VHost is an environment-isolated, non-secret application runtime setting. The contract intentionally does not hardcode `/` or another VHost name, and implicit/default VHost use is forbidden.

Organization and Workflow lifecycle events remain reusable Message components without queues because no consumer/translation contract is yet accepted. The private Job envelope likewise has no channel until a concrete `jobType`, owning handler and queue policy are reviewed. This fail-closed distinction prevents a schema from silently creating a competing consumer or acknowledging work with no owner.

See [ADR-0010](../../docs/08-架构决策/ADR-0010-RabbitMQ与Redis异步执行及Outbox-Inbox.md).
