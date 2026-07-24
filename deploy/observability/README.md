# Observability Deployment

First-stage observability configuration for Pino JSON logging, Sentry error/performance reporting, Tencent Cloud Monitor, external availability probes, alert routing, and health checks.

OpenTelemetry/W3C Trace Context is used in application code for portable propagation, but the first stage does not deploy an OpenTelemetry Collector, Prometheus, Grafana, Loki, ELK/Elastic Stack, Alertmanager, or self-hosted Sentry. Do not create configuration for these components without a new ADR.

Sentry projects, DSNs, upload tokens, alert Webhooks, cloud-monitor credentials, recipients, thresholds, and retention settings are deployment configuration, never repository content. See [ADR-0022](../../docs/08-架构决策/ADR-0022-第一阶段轻量可观测性基线.md), the [first-stage scope](../../docs/01-权威与基线/第一阶段可观测性范围.md), and the [engineering baseline](../../docs/04-工程手册/可观测性与告警基线.md).

## Enablement Gate

Pino writes JSON to stdout/stderr; Docker owns size-bounded rotation. Do not configure application-owned unbounded log files. Verify fixed service/environment/release/instance fields, route templates rather than full URLs, correlation propagation, and sampled output free of credentials, bodies, personal data, provider payloads, and SQL parameters.

Hosted Sentry remains disabled in production until region, data-processing terms, retention/deletion, access, project split, DSN reference, Release policy, sampling, and exit handling are approved. Runtime DSNs use a service-specific `*_FILE` reference; Source Map upload Tokens are separate short-lived CI Secrets and never enter a runtime container or frontend artifact.

Tencent Cloud Monitor thresholds, external probes, receivers, escalation paths, suppression windows, and Runbooks remain for the operations tasks. A production alert is not enabled until it has an actionable Owner and a tested trigger and recovery path. No SLA, RPO, RTO, threshold, or receiver is implied by this directory.
