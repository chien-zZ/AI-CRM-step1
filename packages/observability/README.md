# Observability

Thin project-owned adapters and conventions for Pino structured logging, OpenTelemetry/W3C trace propagation, Sentry error/performance reporting, metric names, and health checks. It standardizes safe fields, redaction, environment/release tags, context lifecycle, and test helpers; it is not an APM backend, log store, business analytics engine, or audit system.

Domain modules use this package's public interfaces and stable technical references. They must not import Pino, Sentry, Tencent Cloud Monitor, or exporter internals directly, and must not emit business objects, request bodies, secrets, tokens, personal data, raw provider payloads, or unbounded labels.

The first stage uses Pino, hosted Sentry, and Tencent Cloud Monitor without an OpenTelemetry Collector, Prometheus, Grafana, Loki, ELK/Elastic Stack, Alertmanager, or self-hosted Sentry. See [ADR-0022](../../docs/08-架构决策/ADR-0022-第一阶段轻量可观测性基线.md), the [first-stage scope](../../docs/01-权威与基线/第一阶段可观测性范围.md), and the [engineering baseline](../../docs/04-工程手册/可观测性与告警基线.md).

## Public API

- `createLogger` emits Pino single-line JSON using fixed service identity, stable operation/outcome names, correlation identifiers, and recursively sanitized fields.
- `runWithCorrelationContext` scopes bounded request/message identifiers through `AsyncLocalStorage`.
- `createTraceContext`, `extractTraceContext`, `createChildTraceContext`, and `injectTraceContext` provide W3C `traceparent` propagation without exposing OpenTelemetry types.
- `createErrorReporter` provides a failure-isolated Sentry adapter. A project-owned `ErrorEventClient` can be injected for tests.
- `evaluateHealth` separates liveness, readiness, and controlled diagnostics.
- `sanitizeTelemetry` is the common fail-closed cleaning boundary for project adapters.

Logger calls accept stable operation names, not arbitrary messages. Raw `Error` messages/stacks, request or response bodies, full URLs, headers, SQL parameters, provider payloads, personal data, credentials, and unbounded user strings are not valid telemetry inputs. Error objects retain only their type and a sanitized Cause chain.

Sentry is disabled until the owning application explicitly enables it after the production region, contract, retention, access, DSN, and sampling review. SDK delivery and flush failures never change application behavior. The public API does not export Pino, Sentry, or OpenTelemetry SDK types.

Health diagnostics expose only stable dependency names and `ok`/`unavailable`; they do not expose connection strings, paths, versions, accounts, queues, or topology. Liveness remains healthy during ordinary downstream failure.
