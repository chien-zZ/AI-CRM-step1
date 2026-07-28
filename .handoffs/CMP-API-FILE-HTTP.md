# CMP API File Center HTTP Adapter

- Status: implementation and scoped verification complete; awaiting Integration Owner wiring/review
- Date: 2026-07-28
- Owned paths: `apps/api/src/platform-http/file-center-http.ts`, matching test, and this handoff

## Known facts

- The reviewed internal contract exposes upload-session creation, upload confirmation, and short-lived download-grant authorization only.
- Upload creation and confirmation are Cookie-session mutations and require trusted Origin/Referer, session-bound CSRF, and a UUID `Idempotency-Key` before Actor/Trace mapping or File Center invocation.
- Download-grant authorization is read-only but security-sensitive. It requires a valid Cookie credential and UUID audited-operation identity, reauthorizes on every call, and may return a fresh ephemeral grant on repeated calls.
- The adapter calls only the `@ai-crm/platform-file-center` public `createUploadSession`, `completeUpload`, and `authorizeDownload` methods.
- The injected Actor resolver is the composition seam for verified session, active workforce association/assignment, and the matching static HTTP permission. The adapter accepts no Actor, Trace, operation ID, reason, bucket, object handle, or provider payload from JSON bodies.

## Allowed assumptions

- The Integration Owner will implement `FileCenterHttpActorResolver` using the existing fail-closed BFF session, organization, and authorization composition, returning an authenticated workforce Actor only after the operation's reviewed HTTP permission succeeds.
- `selectedAssignmentId`, when supplied by the trusted route layer, is a UUID and is revalidated by the adapter before Actor resolution.
- A valid W3C `traceparent` is propagated through the existing observability helper; absent or malformed input receives a locally generated safe Trace ID.
- Fixed bounded reasons identify the three transport operations and are not user-controlled business reasons.

## Forbidden assumptions

- No CRM file category, relation, role, grant, size policy beyond the contract's safe-integer ceiling, provider, bucket, object key, permanent URL, scanner payload, or lifecycle rule is inferred here.
- A valid BFF session, prior upload, FileReference, upload grant, or download URL is never treated as current resource authorization.
- Request JSON cannot override Actor, assignment, Trace, reason, operation identity, storage routing, or returned replay state.
- Unknown dependency failures are not reflected to clients and cannot leak exception text or provider payloads.

## Non-goals

- No controller/framework registration, composition/factory/main wiring, contract/generated artifact, package/lockfile, database, migration, Worker, scanner, storage adapter, or public File Center service change is included.
- No scan, polling, linking, cleanup, reconciliation, deletion, external/anonymous, or binary proxy endpoint is added.

## Implementation summary

- Strict plain-object/exact-key validation rejects arrays, custom prototypes, accessors, extra keys, malformed identifiers, invalid file/resource references, control characters, and non-UUID operation/session/assignment values.
- Mutation security order is UUID operation validation, BFF credential parsing, server-side mutation-session lookup, trusted Origin/Referer plus constant-time session-CSRF validation, then Actor and Trace resolution, then service invocation.
- Responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
- Returned models are explicitly projected to reviewed fields. Provider extensions such as bucket, object handle, ETag, or raw provider payload cannot cross the HTTP boundary. Only the reviewed short-lived upload/download URL and constrained upload headers are returned.
- Durable replay booleans are passed through for upload create/confirm. Download calls are never memoized by the adapter and therefore reauthorize and mint a fresh ephemeral grant per call.
- File Center and browser-session errors map to stable 400/401/403/404/409/503 responses; unknown errors fail closed as `file_center_storage_unavailable` without internal messages.

## Verification evidence

- `pnpm --filter @ai-crm/api typecheck`: passed.
- `pnpm --filter @ai-crm/api lint`: passed.
- `pnpm --filter @ai-crm/api test -- file-center-http.test.ts`: 16/16 passed.
- `pnpm --filter @ai-crm/api test`: 159 passed, 5 integration tests skipped by environment.
- `pnpm --filter @ai-crm/api build`: passed.
- `git diff --check -- apps/api/src/platform-http/file-center-http.ts apps/api/src/platform-http/file-center-http.test.ts .handoffs/CMP-API-FILE-HTTP.md`: passed.

## Eight-area self-review

- Authorization: mutation security runs before Actor resolution and service invocation; the injected resolver is operation-specific and must enforce verified session, active workforce context, and reviewed HTTP permission. File Center still performs current file/resource authorization.
- Idempotency: UUID `Idempotency-Key` becomes the module operation ID. Create/confirm preserve durable replay results; changed semantics remain the service's 409 conflict. Download uses the UUID only as audited identity and executes every time for fresh authorization/grant.
- Transactions: no transaction boundary is added or widened. Durable receipts, metadata, audit intents, and lifecycle Outbox behavior remain owned by the File Center service/store.
- Migrations: no schema or migration changed; no startup synchronization behavior was introduced.
- Observability/Audit: Trace is validated/generated through the shared helper; fixed reasons and UUID operation IDs are mapped into service commands. Responses and errors exclude request bodies, Cookies, CSRF values, URLs beyond the required ephemeral result, provider payloads, and exception text.
- Backward compatibility: the adapter and tests are additive and framework-neutral. Public package entry points, service contracts, HTTP contracts, generated clients, and existing composition are unchanged.
- Secrets: Cookie credentials and CSRF tokens are used only for validation and are never returned. Explicit output projection blocks storage handles, bucket/key values, raw provider data, and URL userinfo; response caching and referrer forwarding are disabled.
- Failure modes: malformed input fails 400 before protected work; missing/invalid sessions fail 401; CSRF/authorization denial fails 403; hidden resources fail 404; lifecycle/idempotency conflicts fail 409; ambiguous authorization/audit/storage/dependency failures fail closed at 503. Tests assert ordering and absence of service calls on early rejection.

## Integration note

- The shared controller/composition owner must wire `FileCenterHttpActorResolver.resolve` to current BFF principal verification, organization workforce resolution (including explicitly selected active assignment), and the exact `platform.file-center.file:upload` or `platform.file-center.file:download` HTTP permission before returning `{ actorId: workforcePersonId, actorType: "authenticated_subject", assignmentId? }`.
- No unresolved contract or module-schema assumption remains in this adapter. Production readiness still depends on the shared route wiring and a reviewed published non-empty authorization policy.

## Integration review closure

- `AuthorizationDeniedError` 与不存在/失效的 workforce context 映射到契约 `403`；授权依赖故障保持脱敏 `503`。
- Actor resolver 收到同一个入站 W3C Trace ID，随后作为 File Center 命令 Trace 使用。
- 生产 storage/scanner Provider 仍未实现并作为 required unhealthy Readiness 依赖；生产不得选择 Local Storage 或合成 Provider。
