# Platform Modules

Business-neutral capabilities shared by current and future applications. Each module exposes a public entry point and owns its data access. Cross-module deep imports and direct table access are prohibited.

`integration-runtime` contains only shared technical resilience, Webhook security, redaction, telemetry, and test primitives for approved provider adapters. Owning modules retain capability ports and business facts; concrete adapters are composed in `apps/api` or `apps/worker`. See [ADR-0020](../../docs/08-架构决策/ADR-0020-第三方集成运行时与供应商适配器.md).

`ai-gateway` owns business-neutral AI use-case governance, version references, routing policy, budgets, safe call metadata, structured-output validation, and non-authoritative proposal semantics. Owning modules retain AI purpose, authorized minimum input, output meaning, human responsibility, and confirmed domain commands. See [ADR-0024](../../docs/08-架构决策/ADR-0024-AI网关与AI治理边界.md).
