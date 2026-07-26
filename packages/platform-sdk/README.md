# Platform SDK

Stable clients and integration helpers for authentication context, authorization, workflow, tasks, notifications, files, audit, events, idempotency, and trace propagation.

Future domain modules depend on this SDK rather than third-party products.

Provider integrations remain capability-specific: the owning module defines a vendor-neutral port, while concrete adapters and provider SDKs stay at application composition boundaries. This SDK must not expose a generic `callProvider`, arbitrary URL execution, provider DTOs, credentials, or integration-runtime persistence. See [ADR-0020](../../docs/08-架构决策/ADR-0020-第三方集成运行时与供应商适配器.md).

AI access is use-case-specific and provider-neutral. The SDK may submit approved AI use cases, query safe call/proposal state, and carry human-review requirements, but it must not expose generic raw-Prompt generation, model credentials, provider parameters, arbitrary tools, or direct domain mutation. See [ADR-0024](../../docs/08-架构决策/ADR-0024-AI网关与AI治理边界.md).

Authorization access is exposed as stable check, batch-check, and structured data-scope operations. Domain modules do not depend on an authorization engine or receive vendor-specific policy objects.

IAM-03 implements this boundary through `createPlatformAuthorizationClient`. The client exposes only Check, Batch Check, Data Scope Resolution, and `requireAllowed`, which performs the server-side decision before throwing a stable denial. Policy registration, role/grant storage, Redis caching, and decision recording remain behind the authorization module and are not SDK capabilities.

The SDK is intentionally narrower than a general `shared-core`: it exposes platform capabilities but does not own UI state, generated HTTP models, or business-domain helpers. See [ADR-0003](../../docs/08-架构决策/ADR-0003-Monorepo应用与模块边界.md).
