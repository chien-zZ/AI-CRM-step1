# INF-02 Configuration, Secrets, And Observability

- Status: completed
- Owner: current single-AI serial development task
- Branch: `codex/INF-02-config-observability`
- Allowed paths: `packages/config`, `packages/observability`, `deploy/secrets`, `deploy/observability`, related dependency manifests, checks, tests, and engineering documentation

## Known Facts

- The current stage is the business-neutral technical foundation; no CRM entity, field, permission, SLA, workflow route, or business metric may be introduced.
- Production Secrets use root-owned restricted host files, per-service read-only mounts, and typed `*_FILE` references. Production `.env` files and Secret environment values are forbidden.
- The first observability baseline is Pino JSON logs, hosted Sentry, Tencent Cloud Monitor, external probes, and OpenTelemetry/W3C propagation.
- Logs, Sentry, Trace attributes, metrics, and health responses must exclude credentials, cookies, tokens, bodies, personal data, customer content, raw provider payloads, SQL parameters, and unbounded user text.
- Audit facts, business facts, logs, metrics, health, and error/trace events have separate truth semantics.
- Sentry production region, contract, retention, sampling, DSN, upload Token, and alert owners remain unresolved; this task must not create or fake them.
- Repository execution for this task is serial; no parallel Agent is writing shared paths.

## Allowed Assumptions

- Pin Pino 10.3.1, Sentry Node 10.67.0, OpenTelemetry API 1.9.1, and OpenTelemetry Core 2.10.0; later upgrades require dependency review.
- Project-owned public interfaces may wrap these libraries while keeping vendor types private.
- Non-secret environment values can use a small declarative project schema with explicit bounds and safe errors.
- Secret values are read into process memory only for the owning service consumer and are never returned in error messages or telemetry.
- W3C `traceparent` may be accepted only after standards-based validation; invalid input creates a new local context.
- Local development may skip POSIX permission enforcement, while production configuration fails closed unless Secret file permissions match the approved restricted modes.

## Forbidden Assumptions

- Do not add Vault, Tencent Cloud Secrets Manager, a production `.env`, an OpenTelemetry Collector, Prometheus, Grafana, Loki, ELK, Alertmanager, or self-hosted Sentry.
- Do not create Sentry projects, DSNs, Tokens, Webhooks, cloud credentials, production host paths, alert recipients, sampling rates, retention periods, SLA values, or thresholds.
- Do not expose Pino, Sentry, or OpenTelemetry SDK types from public package contracts.
- Do not make logging, Sentry delivery, or Trace propagation authoritative for authorization, idempotency, transactions, audit, or business outcomes.
- Do not accept arbitrary log messages, labels, contexts, request bodies, URLs with query strings, or raw errors as safe telemetry.

## Non-goals

- No HTTP middleware, NestJS composition, RabbitMQ propagation, frontend Sentry SDK, Source Map upload, Tencent Cloud Agent, external probe, or production alert rule is implemented here.
- No real Secret inventory values, host provisioning, rotation execution, offline recovery bundle, or `age` key is created.
- No audit module, business metric, dashboard, or centralized log storage is implemented.

## Required Tests

- Configuration covers required/default values, type and bound validation, duplicate variables, URL credential rejection, and frozen results.
- Secret handling covers missing references, unreadable files, non-files/symlinks, empty/multiline/oversized values, restricted permissions, and safe errors.
- Redaction covers nested objects, arrays, Error causes, accessors, cycles, sensitive keys and values, unknown object types, depth/size limits, and stable output.
- Logging emits one valid JSON line with fixed fields and safe context without leaking raw errors or redacted data.
- Trace tests cover valid extraction, invalid/all-zero rejection, local generation, child spans, and injection.
- Sentry adapter tests prove disabled/unavailable delivery does not throw and only stable safe fields reach the client boundary.
- Health tests distinguish liveness, readiness, and diagnostics without exposing dependency details.

## Unresolved Questions

- Sentry region, data-processing agreement, project split, retention, sampling, Source Map policy, and production enablement remain for OPS/security review.
- Tencent Cloud Monitor thresholds, receivers, escalation, and Runbooks remain for OPS-01/OPS-02.
- The final production Secret root, Linux users/groups, inventory Owners, rotation intervals, and emergency contacts remain unresolved.
- Application-specific configuration schemas will be composed in their owning application tasks; INF-02 provides the reusable technical boundary only.
- The accepted G1 database dependency must be upgraded from vulnerable `drizzle-orm@0.44.3` to a reviewed patched release in a separate DAT-01 change.

## Implementation Evidence

- `packages/config` implements typed startup schemas, frozen results, safe error codes, production permission enforcement, and fail-closed `*_FILE` reads.
- `packages/observability` implements Pino JSON logging, bounded correlation context, OpenTelemetry W3C propagation, a failure-isolated Sentry adapter, recursive cleaning, and separated health semantics.
- Package public entry points expose only project-owned interfaces and values; vendor SDK types remain private.
- Unit coverage includes invalid runtime schemas and variable names, permissions and hostile Secret files, nested redaction, arrays, Error Cause, accessors, cycles, hostile reflection, size limits, untrusted Trace/context values, logging, trace extraction/injection, Sentry failure isolation, duplicate health inputs, and health degradation.
- `pnpm install --frozen-lockfile` passes. The focused `config` and `observability` gate passes 10/10 package tasks with 17 and 24 unit tests respectively; full `pnpm check` passes 140/140 Workspace tasks.
- `pnpm audit --prod` reports no advisory in the INF-02 dependencies. It reports the pre-existing `drizzle-orm@0.44.3` advisory GHSA-gpj5-g38j-94v9; remediation belongs to a separate DAT-01 dependency patch with database regression tests.

## Separate Review Pass

- Authorization: these packages grant no user or service authorization. Secret distribution authorization remains an OPS control and must fail closed.
- Idempotency: configuration is immutable after startup; telemetry delivery is non-authoritative and cannot affect retry or business outcomes.
- Transactions and migrations: no database access or schema change is introduced.
- Observability and security: raw errors, bodies, credentials, personal data, provider payloads, SQL parameters, query strings, and uncontrolled strings are excluded or redacted; SDK failures are isolated.
- Backward compatibility: both package entry points previously exposed only `packageId`, which remains exported; the new APIs are additive. Dependency versions are pinned in the package manifest and lockfile.
- Integration history: only the INF-02 patch was transplanted onto the accepted G1 Drizzle baseline. Its obsolete Prisma-based ancestor history, authority-file edits, TypeScript 6 toolchain, and alternate Workspace conventions were excluded.
- Development process: implementation and review were completed serially to preserve shared-path ownership; no parallel Agent was used.
