# AI-CRM Repository Rules

## Authority Order

When sources conflict, use this order:

1. The current user request.
2. This file.
3. Accepted ADRs in `docs/08-架构决策/`.
4. Contracts in `contracts/`.
5. Module documentation in `docs/03-模块说明/`.
6. Confirmed business rules in `docs/02-业务规则/`.
7. Interview documents and other material in `docs/` and `references/`.
8. Temporary task handoffs in `.handoffs/`.

Interview documents are research inputs, not finalized specifications. Do not invent CRM entities, fields, states, permissions, SLAs, or approval routes from them without an accepted business rule or ADR.

## Current Stage

The current scope is the common technical foundation and a business-neutral walking skeleton. Do not implement CRM domain modules such as leads, orders, settlements, products, partners, students, or dashboards until their boundaries are confirmed.

Use `docs/04-工程手册/第一阶段AI并行开发实施计划.md` for first-stage work packages, dependencies, path ownership, merge gates, and AI task handoffs. Use `docs/06-质量验收/第一阶段Walking-Skeleton验收清单.md` for acceptance evidence. These execution documents remain subordinate to this file, accepted ADRs, and reviewed contracts.

For `apps/workbench-web`, use `docs/04-工程手册/PC工作台Demo参考基线.md` as the design and interaction reference. The referenced Demo is not a source of production code, dependencies, routes, roles, entities, fields, states, permissions, SLAs, approval routes, or other business rules.

## Architecture Boundaries

- `apps/` contains independently runnable and deployable programs.
- `packages/platform-modules/` contains business-neutral platform capabilities.
- `packages/domain-modules/` is reserved for confirmed business domains.
- Domain modules may depend on `platform-sdk` and contracts. They must not depend directly on Keycloak, Flowable, RabbitMQ, Redis, or storage vendors.
- No module may query another module's tables directly.
- No deep imports across module boundaries. Import only through each package's public entry point.
- PostgreSQL data is partitioned by module-owned schemas and repositories. Database row types, Drizzle schema objects, query builders, and transaction handles are not public module contracts.
- Production schema changes use reviewed, versioned Drizzle SQL migrations. Application startup and deployment must not use automatic schema synchronization or `drizzle-kit push`.
- HTTP and event contracts are changed before implementations.
- Source OpenAPI files are split by module. The bundled OpenAPI document is generated and must not be edited manually.
- Domain events are transport-neutral. RabbitMQ topology and private worker job payloads belong in `contracts/asyncapi/` and `contracts/jobs/`, not `contracts/events/`.
- Workflow state, unified task projections, reminders/SLA, and background jobs are separate concerns.
- Business modules store stable file references only. They must not expose object-storage buckets, keys, credentials, or permanent provider URLs, and must not call storage vendors directly.
- Runtime technical configuration, business dictionaries/parameters, form definitions, and submitted domain data are separate concerns. Secrets never enter business configuration, and submitted form data remains owned by its domain module.
- Published form and business-configuration versions are immutable. Runtime decisions that depend on them record the resolved version; client rendering and visibility rules never replace server-side validation or authorization.
- Notification intent, in-app notification state, task state, and external-channel delivery are separate facts. A notification never proves that work was completed or that a provider message was read.
- Domain modules request notifications through stable contracts. They must not call WeCom, SMS, email, push, or other channel providers directly.
- `workbench-web`, `internal-mobile`, and `external-portal` are separate applications and deployment artifacts. External clients must consume an allowlisted external OpenAPI surface, never a complete internal client hidden by UI checks.
- Taro applications isolate target-specific behavior behind adapters. They must not import Ant Design/ProComponents or assume the PC Web React major; shared UI is promoted only after real cross-application reuse.
- PC Web and H5 clients use isolated BFF HTTP-only sessions; the WeChat Mini Program may hold only a short-lived opaque server-session handle. Client code and domain modules must never receive Keycloak tokens, provider secrets, or the WeChat `session_key`.
- External provider identifiers are trusted only after server-side verification and Keycloak subject establishment. Do not auto-link identities by phone, email, name, `userid`, `openid`, or `unionid`.
- Keycloak owns provider federation; `organization` owns the effective association from an internal Keycloak subject to a workforce person. WeCom login identity, directory-source mapping, and notification address are separate concerns and must not share tables or grant access implicitly.
- Internal access fails closed without a unique workforce person and active employment. Closing one assignment revokes only that context; it does not imply departure or delete history.
- External operations explicitly choose anonymous, restricted-invitation, or authenticated access. An invitation capability is not an identity, must not be unioned with login grants, and never bypasses the owning module's current resource-state check.
- Do not create a generic external-user model, invitation table, anonymous endpoint, or external-access package until a confirmed domain scenario owns the resource and contract.
- Provider integrations use a vendor-neutral port owned by the capability module, the business-neutral `integration-runtime` for shared technical primitives, and a concrete adapter composed in `apps/api` or `apps/worker`.
- `integration-runtime` must not own domain facts, expose arbitrary external URL execution, become a cross-module orchestration layer, or provide a second message transport beside the Outbox/RabbitMQ/Inbox path.
- Domain modules must not import provider SDKs or adapter implementations. Provider responses and Webhooks become business facts only after the owning module accepts them through reviewed commands or events.
- Do not create a concrete payment, SMS, WeCom, WeChat, course-platform, question-bank, or AI adapter/schema until its capability Owner, provider protocol, test account, data boundary, idempotency, retry, callback, reconciliation, authorization, and acceptance scenario are confirmed.
- The first production topology is two Tencent Cloud Ubuntu CVMs with a separate self-hosted Docker Compose project per host. Do not introduce Kubernetes, Docker Swarm, or production managed PostgreSQL/Redis/RabbitMQ without a new accepted ADR.
- Two API replicas do not make Nginx, PostgreSQL, Redis, RabbitMQ, Keycloak, or Flowable highly available. Do not claim automatic failover, an SLA, RPO, or RTO until the topology and recovery drills prove it.
- Production images use immutable versions or digests. State services stay private, backups leave the two-server failure domain, and production secrets never appear in Compose files, images, logs, frontend artifacts, or repository files.
- The first observability baseline is Pino structured logs, hosted Sentry error/sample-trace reporting, Tencent Cloud Monitor, external uptime probes, and OpenTelemetry/W3C propagation. Do not add an OpenTelemetry Collector, Prometheus, Grafana, Loki, ELK/Elastic Stack, Alertmanager, or self-hosted Sentry without a new accepted ADR.
- Audit records, business facts, application logs, metrics, and error/trace events have separate owners, retention, and truth semantics. Technical telemetry may correlate through safe trace references but never replaces audit evidence.
- Logs, Sentry events, metric labels, Trace attributes, and health responses must exclude credentials, cookies, tokens, request/response bodies, personal data, customer content, raw provider payloads, SQL parameters, and unbounded user-controlled strings. Domain modules depend on `packages/observability`, not telemetry vendor SDKs.
- Production Secret management uses root-owned restricted host files, per-service Docker Compose Secret/read-only mounts, and typed `*_FILE` references. Do not add Vault, Tencent Cloud Secrets Manager, production Secret environment values, encrypted production Secrets in Git, or a production `.env` without a new accepted ADR.
- Every Secret is environment-, service-, and purpose-specific, fails closed when missing, and has an Owner, consumers, rotation/revocation procedure, and incident action recorded without its value. Containers receive only the Secret files they need.
- Production Secret values must not appear in Compose YAML, Dockerfiles, image layers, command arguments, shell history, databases, business configuration, logs, Sentry, Trace data, frontend artifacts, documentation, tickets, chat, or backups. Disaster-recovery Secret bundles are encrypted before leaving the host with an offline key not stored on the production hosts or in COS.
- Product AI calls use registered owning-module use cases through `platform-sdk`, the business-neutral `ai-gateway`, `integration-runtime`, and an application-composed Provider Adapter. Domain modules must not import model SDKs, submit arbitrary raw prompts, select unapproved models, or query AI gateway tables directly.
- Model output is an untrusted, non-authoritative proposal. It cannot change domain state, approval, authorization, finance, pricing, personnel, performance, or allocation until an authorized human confirms it and the owning module rechecks authorization and current invariants through a formal command.
- Do not create a real AI provider adapter, model credential, CRM prompt, customer scoring, summary use case, RAG/vector store, knowledge base, tool/MCP execution, LiteLLM, LangChain, or LangGraph integration until its Owner, data boundary, provider region/contract, budget, acceptance set, retention, authorization, and human-review behavior are confirmed.
- AI telemetry and call metadata must exclude full prompts, model responses, chain-of-thought, customer/employee content, credentials, and raw provider payloads. Development/provider evaluation uses synthetic data; de-identification alone never authorizes cross-border model use.

## AI Development Rules

- Every task must state known facts, allowed assumptions, forbidden assumptions, and non-goals.
- Record unresolved assumptions in the relevant task handoff. Do not silently encode them in schemas.
- Keep changes scoped. Do not create speculative empty business modules.
- Prefer adapters around third-party systems over modifying their source code.
- Add or update tests with every behavioral change.
- A separate review pass must check authorization, idempotency, transactions, migrations, observability, and backward compatibility.
- Never put permanent business rules in `.handoffs/`.

## Definition Of Done

A change is complete only when applicable items are present:

- Contract or schema changes are documented and versioned.
- Unit, contract, integration, or end-to-end tests cover the behavior.
- Authorization and audit behavior are explicit.
- Idempotency, retry, timeout, and failure behavior are defined.
- Database changes include reversible migration guidance.
- Logs, metrics, traces, and health checks are included for runtime components.
- Secrets are configuration references, never committed values.
- User-facing and operator documentation is updated.
- `pnpm check` passes.
