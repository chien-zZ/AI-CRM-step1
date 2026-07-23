# Contracts

Contracts are reviewed before implementations. Source specifications are split by module; generated aggregate artifacts are published for consumers.

Form, business-configuration, notification, provider-neutral integration, and AI governance source contracts live in `contracts/forms/`, `contracts/configuration/`, `contracts/notifications/`, `contracts/integrations/`, and `contracts/ai/`. Published runtime form/configuration/template/prompt versions are application data, not generated contract bundles.

Integration contracts describe stable capability-port models and technical failure semantics. Provider SDK types, signatures, headers, cursors, and business facts do not become shared contracts merely because an adapter consumes them. See [ADR-0020](../docs/08-架构决策/ADR-0020-第三方集成运行时与供应商适配器.md).

AI contracts describe registered use cases, safe version references, invocation metadata, structured outputs, non-authoritative proposals, and human-review requirements. They never make model output a domain command or expose raw provider prompts, responses, credentials, or arbitrary tools. See [ADR-0024](../docs/08-架构决策/ADR-0024-AI网关与AI治理边界.md).
