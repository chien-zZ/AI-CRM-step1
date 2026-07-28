# CMP API Application Registry HTTP Adapter

- Status: implementation complete; awaiting integration-owner wiring and review
- Scope: `apps/api/src/platform-http/application-registry-http.ts`, its unit test, and this handoff only

## Known facts

- The reviewed internal OpenAPI surface exposes only registry snapshot loading and Task/Notification deep-link resolution.
- The public Application Registry service owns current audience, enablement, source allowlist, and target authorization checks.
- Internal BFF authentication and Organization workforce resolution happen before this adapter receives its trusted request context.
- The Application Registry query service accepts an Actor but no operation metadata; the HTTP trace remains transport correlation and is returned only as a bounded validated trace header.

## Allowed assumptions

- The integration controller passes a server-constructed context containing a stable bounded Actor ID, unique active Workforce Person ID, optional selected active Assignment ID, and W3C-compatible non-zero Trace ID.
- Application Registry reads are internal-only and therefore always invoke the service with `audience: "internal"`.
- `Cache-Control: no-store` is appropriate for a principal-specific registry snapshot and authorization result.

## Forbidden assumptions

- No role, grant, policy seed, application, route, navigation item, display text, CRM entity, or default authorization is inferred or created.
- Client JSON cannot provide Actor, Workforce Person, Assignment, Trace, audience, arbitrary URL, provider identifier, or secret.
- A resolved route is not durable authorization and the adapter does not join the path and opaque resource reference.
- Invalid authentication context never falls back to a system or anonymous Actor.

## Non-goals

- No Nest/Express controller, shared composition, route registration, factory, package, lockfile, contract, generated client, or platform module is changed.
- Registry management mutations and external-audience endpoints remain unexposed.
- This adapter does not duplicate module authorization, persistence, audit, or transaction behavior.

## Unresolved integration assumptions

- The shared controller/request-context type and the exact stable non-personal `actorId` derivation convention remain integration-owner decisions. This adapter deliberately accepts only the already-derived bounded reference and does not hash, concatenate, or reinterpret OIDC `issuer + sub`.
- Route registration and static operation-permission enforcement remain in the shared HTTP composition work; they must complete before either method is production reachable.

## Integration notes

- Wire `loadRegistry` to `GET /application-registry` and `resolveDeepLink` to `POST /application-registry/deep-links/resolve` only after the existing BFF session, Organization context, and declared operation permission have succeeded.
- Construct `actorId` at the trusted authentication boundary using the project's reviewed stable subject-reference convention; do not accept it from headers or JSON.
- Malformed trusted context maps to `401 app_registry_unauthorized`; strict body failures map to `400`; module denial/target/conflict/unavailability map to `403/404/409/503`; unexpected failures are sanitized to `503`.

## Verification and eight-area review

- `vitest` single-file run with aggregate coverage disabled: 19/19 passed.
- Dedicated ESLint run for the two implementation files: passed with zero warnings.
- `git diff --check` for the three owned files: passed.
- API TypeScript check reported no Registry adapter diagnostics; the aggregate remains blocked by a concurrent, out-of-scope `file-center-http.test.ts` spread-type diagnostic.

- Authorization: internal audience is constant; Actor is authenticated-only; module current authorization remains authoritative.
- Idempotency: both operations are read-only and create no receipts or retry claims.
- Transactions: no transaction is introduced or widened.
- Migrations: no schema or migration changes.
- Observability/Audit: only a validated Trace ID is reflected; bodies, credentials, causes, and resource content are never logged or exposed; query audit behavior stays module-owned.
- Backward compatibility: additive standalone adapter only; no existing export, route, composition, or contract changes.
- Secrets: context/body reject extra fields; arbitrary URLs, credentials, cookies, and tokens cannot cross this boundary.
- Failure modes: invalid context, invalid input, denial, hidden missing/disabled target, conflict, dependency outage, and unknown errors fail closed with stable sanitized responses.

## Integration review closure

- Nest now resolves the BFF credential, current workforce and catalogued static permission before this Adapter performs Registry's dynamic application/route authorization.
- One inbound W3C Trace ID is used by the authorization decision recorder and response correlation.
- Production Registry query binding remains explicitly unavailable and is a required unhealthy Readiness dependency; no seed or synthetic registration was introduced.
