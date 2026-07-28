# Audit

Owns explicit append-only security facts with Actor/effective workforce context, Action, Resource, Result, Reason, controlled Before/After changes, and W3C Trace correlation. Facts are never inferred from Pino, Sentry, traces, request bodies, or log keywords.

`createAuditService` accepts only action-specific field policies. Non-sensitive scalar differences are bounded; sensitive fields disclose only `changed: true`. Credentials, cookies, tokens, raw payloads, prompts, customer content, and unbounded values are forbidden. The sensitive-read entry authorizes the current actor against the target record and durably records denied, failed, or successful access before data can escape.

The PostgreSQL store uses the module-owned `audit` schema. Records and operation receipts are protected by database triggers from UPDATE/DELETE. An operation UUID plus semantic fingerprint makes retries and concurrent duplicates safe; a changed semantic payload fails closed. The first audit ID and occurrence time remain authoritative on replay even when a retry carries a new Trace or generated ID.

`createPostgresAuditCapabilityProbe` exposes an independent, audit-owned technical capability check for application composition. It issues one read-only PostgreSQL query and reports `available` only when the current session is not read-only and the Store's schema, relations, relation privileges, hashing function, and advisory-lock function are observable. Missing, negative, malformed, or unavailable evidence returns only `unavailable`; no SQL, role, relation, topology, or error detail escapes the module. The probe never starts a transaction or creates an Audit or receipt fact.

This result is a conservative check of observable prerequisites, not proof that a future append or commit will succeed. Callers own timeouts, scheduling, cached Readiness state, shutdown invalidation, and recovery. Production grants and role provisioning remain separately reviewed deployment and migration concerns.

Migration `0000000005` is additive and creates empty structures. Application rollback retains evidence; repairs use a new forward migration. The module migration command requires `DATABASE_MIGRATION_URL_FILE` and is never called during application startup.

Audit records are durable security evidence and are separate from application logs. Observability sampling and retention never govern audit retention. Concrete retention, break-glass access, export, and cryptographic sealing remain governance decisions outside PLT-01.
