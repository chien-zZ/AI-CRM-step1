# Integration Runtime

Business-neutral runtime primitives for provider integrations: deadlines, retry classification, rate/concurrency limits, circuit breaking, redaction, telemetry, Webhook verification interfaces, replay protection, and test fault injection.

Owning platform or domain modules define vendor-neutral capability ports and retain business facts. Concrete provider adapters are composed by `apps/api` or `apps/worker`; domain modules never import provider SDKs or call arbitrary external URLs through this package.

The first stage contains no payment, SMS, WeCom push, WeChat notification, course-platform, question-bank, or AI adapter. See [ADR-0020](../../../docs/08-架构决策/ADR-0020-第三方集成运行时与供应商适配器.md), the [module description](../../../docs/03-模块说明/第三方集成运行时.md), and the [first-stage scope](../../../docs/01-权威与基线/第一阶段第三方集成范围.md).

Future AI Provider Adapters may reuse this package's deadlines, rate limits, retry classification, redaction, and telemetry, but AI use-case registration, prompt/model/data policy, budgets, structured proposals, and human-review semantics belong to `ai-gateway`. See [ADR-0024](../../../docs/08-架构决策/ADR-0024-AI网关与AI治理边界.md).
