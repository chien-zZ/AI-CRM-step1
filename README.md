# AI-CRM

AI-CRM is currently building its common technical foundation before finalized CRM business workflows are implemented.

## Current Scope

- Workbench application shell
- Internal mobile and external-client application shells
- Authentication and organization context
- Authorization facade
- Workflow integration
- Unified tasks and notifications
- Form schemas and file handling
- Audit, events, and observability
- A business-neutral end-to-end demo flow

Business interview documents under `docs/` are reference material. Confirmed rules will be promoted into `docs/02-业务规则/` before domain implementation.

## Repository Map

- `apps/`: independently runnable composition roots for API, Worker, PC Web, internal mobile, and external portal; application processes do not own platform or domain rules
- `packages/platform-modules/`: business-neutral platform capabilities
- `packages/domain-modules/`: confirmed business domains, currently intentionally empty
- `packages/platform-sdk/`: stable, vendor-neutral access to platform capabilities
- `contracts/`: reviewed HTTP, event, job, permission, form, business-configuration, notification, provider-neutral integration, AI governance, error, and shared model contracts
- `tests/`: cross-application tests
- `deploy/`: local, test, and production deployment definitions
- `docs/`: architecture, rules, module descriptions, and operating manuals

The API and worker are separate processes because synchronous HTTP and background execution have different scaling and failure behavior. Platform and domain packages may still be composed as a modular monolith; package boundaries do not imply microservices. See [ADR-0003](docs/08-架构决策/ADR-0003-Monorepo应用与模块边界.md).

Third-party capabilities use owning-module ports, a small business-neutral integration runtime, and provider adapters composed at application boundaries. The repository does not contain a giant integration gateway or any unapproved payment, messaging, WeCom, WeChat, course-platform, question-bank, or AI adapter. See [ADR-0020](docs/08-架构决策/ADR-0020-第三方集成运行时与供应商适配器.md).

The first production topology uses two Tencent Cloud Ubuntu CVMs with self-hosted Docker Compose services and Nginx routing. It is intentionally cost-first and is not represented as automatic high availability; recovery relies on off-host backups and tested runbooks. See [ADR-0021](docs/08-架构决策/ADR-0021-第一阶段两台云服务器Docker-Compose部署.md).

The first observability baseline uses Pino JSON logs, hosted Sentry error and sampled-trace reporting, Tencent Cloud Monitor, and external uptime probes. It deliberately does not operate a Collector, Prometheus/Grafana, Loki/ELK, Alertmanager, or self-hosted Sentry. See [ADR-0022](docs/08-架构决策/ADR-0022-第一阶段轻量可观测性基线.md).

Production Secrets use restricted per-host files, Docker Compose Secret mounts, and typed `*_FILE` references. The first stage does not operate Vault or Tencent Cloud Secrets Manager and does not store Secret values in Git, Compose YAML, production `.env`, databases, logs, Sentry, or client artifacts. See [ADR-0023](docs/08-架构决策/ADR-0023-文件式Secret与两台主机安全基线.md).

Product AI capabilities use a business-neutral, self-developed AI gateway for registered use cases, data/prompt/model policy, budgets, structured non-authoritative proposals, and human-review enforcement. The first stage has no real model provider, CRM Prompt, RAG, tools, LiteLLM, LangChain, or autonomous domain action. See [ADR-0024](docs/08-架构决策/ADR-0024-AI网关与AI治理边界.md).

First-stage implementation and parallel AI work are governed by the [AI parallel implementation plan](docs/04-工程手册/第一阶段AI并行开发实施计划.md) and the [Walking Skeleton acceptance checklist](docs/06-质量验收/第一阶段Walking-Skeleton验收清单.md). They do not override accepted ADRs or contracts.

PC workbench design and interaction should follow the [existing Demo reference baseline](docs/04-工程手册/PC工作台Demo参考基线.md). The Demo is not a source of production architecture, contracts, roles, fields, states, or business rules.

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm lint
pnpm typecheck
pnpm check
```

Packages and executable applications will add their own scripts as implementation begins.
