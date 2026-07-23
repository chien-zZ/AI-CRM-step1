# Observability

Thin project-owned adapters and conventions for Pino structured logging, OpenTelemetry/W3C trace propagation, Sentry error/performance reporting, metric names, and health checks. It standardizes safe fields, redaction, environment/release tags, context lifecycle, and test helpers; it is not an APM backend, log store, business analytics engine, or audit system.

Domain modules use this package's public interfaces and stable technical references. They must not import Pino, Sentry, Tencent Cloud Monitor, or exporter internals directly, and must not emit business objects, request bodies, secrets, tokens, personal data, raw provider payloads, or unbounded labels.

The first stage uses Pino, hosted Sentry, and Tencent Cloud Monitor without an OpenTelemetry Collector, Prometheus, Grafana, Loki, ELK/Elastic Stack, Alertmanager, or self-hosted Sentry. See [ADR-0022](../../docs/08-架构决策/ADR-0022-第一阶段轻量可观测性基线.md), the [first-stage scope](../../docs/01-权威与基线/第一阶段可观测性范围.md), and the [engineering baseline](../../docs/04-工程手册/可观测性与告警基线.md).
