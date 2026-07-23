# API Application

NestJS composition root for synchronous HTTP APIs and optional real-time delivery. It wires platform and confirmed domain modules together but must not contain domain logic itself.

It is separated from `apps/worker` so HTTP latency, connection handling, scaling, health, and failure behavior can be managed independently from retries and long-running jobs. This separation does not require platform or domain packages to be deployed as microservices.

This application hosts isolated BFF authentication boundaries for the approved clients. PC Web and both H5 artifacts receive only opaque, secure, HTTP-only cookies; the WeChat Mini Program receives only a short-lived, revocable opaque session handle. Keycloak tokens and provider secrets remain server-side, and the BFF does not issue its own authentication JWT. See [ADR-0005](../../docs/08-架构决策/ADR-0005-PC-Web采用BFF登录会话.md) and [ADR-0017](../../docs/08-架构决策/ADR-0017-多客户端认证与服务端会话.md).

Reviewed synchronous provider adapters and Webhook entry adapters are composed here when a real integration is approved. Webhooks must verify the raw request and durably register the receipt before asynchronous business processing; this application does not own provider business state or expose a generic arbitrary-URL proxy. No concrete third-party adapter is part of the first-stage scope. See [ADR-0020](../../docs/08-架构决策/ADR-0020-第三方集成运行时与供应商适配器.md).

This process uses the project observability boundary for Pino JSON logs, safe Trace Context propagation, Sentry error reporting, and liveness/readiness checks. It never logs or reports credentials, sessions, request bodies, personal data, or raw provider payloads. See [ADR-0022](../../docs/08-架构决策/ADR-0022-第一阶段轻量可观测性基线.md).

Future approved synchronous AI adapters are composed here only for use cases that must return an immediate proposal within a strict deadline. Clients cannot submit arbitrary system prompts, choose unapproved providers, invoke tools, or turn model output into a domain command. The first stage has no real model adapter. See [ADR-0024](../../docs/08-架构决策/ADR-0024-AI网关与AI治理边界.md).

See [ADR-0003](../../docs/08-架构决策/ADR-0003-Monorepo应用与模块边界.md).
