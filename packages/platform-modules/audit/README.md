# Audit

Owns append-only audit events describing actor, action, resource, result, reason, changes, and trace context. Audit records are separate from application logs.

Audit records are durable business-security evidence and are not emitted to Pino or Sentry as a substitute. A `trace_id` may safely correlate approved records with technical diagnostics, but observability retention, sampling, and access policy never govern audit retention. See [ADR-0022](../../../docs/08-架构决策/ADR-0022-第一阶段轻量可观测性基线.md).
