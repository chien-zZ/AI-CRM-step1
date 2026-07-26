# Notifications

Business-neutral Notification Center core for explicit notification intents, immutable plain-text template releases, actual recipient snapshots, preference decisions, and PostgreSQL-backed in-app user state.

First-stage behavior is intentionally limited to PC polling semantics: list, detail, unread count, mark read, and archive. The module exposes ports for authorization, audit, recipient resolution, preferences, and observation; composition remains in `CMP-01`.

## Invariants

- Intent idempotency is scoped by `producer + idempotencyKey`; reuse with a different fingerprint fails.
- Recipients are stable references resolved by an injected public port. The module never queries organization or domain tables.
- Published template versions are immutable. Notifications retain rendered title/body and the exact template version.
- Templates are restricted Mustache plain text with JSON Schema validation. Raw tags, sections, partials, prototype names, missing variables, unknown variables, and invalid values fail closed.
- Deep links contain only `applicationId + routeId`, stable resource references, and bounded non-sensitive parameters. Arbitrary URLs are not accepted.
- In-app read/archive state is principal scoped and idempotent. It never changes Task or domain state.
- Suppression is a recorded preference decision, not deletion of the accepted intent or recipient fact.

## Failure and recovery

- Authorization, audit, recipient resolution, validation, and storage failures use stable errors and fail closed.
- Intent and recipient/in-app facts are inserted in one PostgreSQL transaction. Concurrent duplicate requests return the original result.
- Migration `0000000009_notifications.sql` is additive. After production use, forward-fix and preserve accepted intent/read-state history instead of dropping the schema.
- RabbitMQ delivery workers and any retry/dead-letter composition remain `CMP-01`; PostgreSQL notification facts are authoritative and external transport failure must not delete them.

## Verification

```text
pnpm --filter @ai-crm/platform-notifications lint
pnpm --filter @ai-crm/platform-notifications typecheck
pnpm --filter @ai-crm/platform-notifications test
pnpm --filter @ai-crm/platform-notifications test:integration
pnpm --filter @ai-crm/platform-notifications build
```

No WeCom, WeChat, SMS, email, push, WebSocket, SSE, provider adapter, CRM notification type, role, SLA, or recipient policy is implemented here.
