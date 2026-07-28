# CMP HTTP Platform Contracts

- Status: implementation complete; verification passed; awaiting Integration Owner review/merge
- Date: 2026-07-28
- Owner scope: `contracts/http/modules/{app-registry,form-schema,file-center}.openapi.yaml`, `contracts/permissions`, generated OpenAPI/API Client artifacts, permission contract gates, this handoff

## Known facts

- PLT-01, PLT-02, and PLT-03 are G2 accepted and expose business-neutral public services for Application Registry, immutable Form releases/validation, and File Center upload/download lifecycle operations.
- All three HTTP documents are internal-only and use the BFF session boundary. Each protected operation binds one exact business-neutral `PermissionRequest` declaration.
- The permission catalog is declaration-only. This change creates no Permission row, Role, Grant, published policy, policy seed, or default allow.
- Registry returns only enabled, authorized internal snapshot entries and rechecks application/route/source/target state for each deep-link resolution.
- Form reads and validates one exact immutable release. Submitted validation data is not persisted and client validation is never authoritative.
- File Center creates a short-lived upload session, confirms trusted metadata only to `pending_scan`, and issues a fresh short-lived download grant after current file/resource authorization. Scan remains an internal Worker responsibility.

## Allowed assumptions

- The API adapter derives Actor, Trace, bounded Reason, and UUID operation identity from the authenticated request context and reviewed headers; these server-owned command metadata fields are not accepted in JSON request bodies.
- `Idempotency-Key` maps to the module UUID operation ID. Durable upload commands replay the original operation receipt; the download-grant operation uses the key only as stable audited-operation identity and may mint a fresh ephemeral grant.
- `Origin`/`Referer` and the session-bound `X-CSRF-Token` are enforced by the BFF session layer for state-changing Cookie requests before invoking the platform service.

## Forbidden assumptions

- No CRM application, navigation item, form, field, file classification, relation, role, permission grant, SLA, workflow, provider, or identity was added.
- No storage bucket, object key/handle, credential, permanent provider URL, provider payload, scanner payload, or binary content crosses the HTTP contract.
- A Registry route path, FileReference, upload grant, download grant, upload confirmation, notification, or transport acknowledgement is not proof of ongoing domain authorization or business completion.
- No external audience, anonymous endpoint, invitation capability, generic external user, or cross-client API was introduced.

## HTTP surface

### Application Registry

- `GET /application-registry` returns the current authorized internal application/route/navigation snapshot.
- `POST /application-registry/deep-links/resolve` is a read-only resolver for Task/Notification descriptors. It returns a registered relative route template and separate resource reference only after current checks.
- Registry management mutations are deliberately absent. The service has management behavior, but no reviewed operator HTTP Owner, administration workflow, or exposure requirement was established for this walking skeleton.

### Form Schema

- `GET /form-definitions/{definitionId}/releases/{releaseVersion}` reads one exact immutable release.
- `POST .../validate` performs bounded server validation without persistence. The Controller contract caps the encoded body at 262144 bytes, JSON depth at 32, and total object/array/scalar nodes at 10000 before authorization and service invocation.
- Draft management, publication, and activation are deliberately absent. Although the service has injected management/publish authorization actions, the current client requirement and operator HTTP Owner are not confirmed sufficiently to expose those control-plane mutations.
- Business Configuration is an explicit non-goal and has no paths or permissions in this work package.

### File Center

- `POST /files/upload-sessions` creates the initial stable file/content reference, durable session, and ephemeral upload grant. Identical retries reuse the durable file/content/session identities while minting a fresh grant that cannot outlive the original session.
- `POST /files/upload-sessions/{sessionId}/confirm` returns the current trusted content-version status and never transitions directly to available.
- `POST /files/download-grants` reauthorizes the current FileReference and owning resource, then returns a fresh short-lived grant.
- The public File Center service has no standalone status-query method, so this contract does not invent a polling endpoint. Status and stable references are returned by the existing create/confirm behaviors. Scanner, cleanup, reconciliation, linking, and storage operations remain internal/not exposed.

## Contract and security semantics

- File upload create/confirm require trusted-origin checking, session-bound `X-CSRF-Token`, and UUID `Idempotency-Key`; identical durable retries replay and changed semantic reuse returns `409`. Create-session replay preserves durable identities but explicitly returns a fresh ephemeral upload grant bounded by the original expiry.
- Registry resolution and Form validation are explicitly read-only POSTs: no CSRF or idempotent mutation claim is made, while session and current authorization remain mandatory.
- Download grants are read-only ephemeral access results. `Idempotency-Key` stabilizes the audited logical operation but does not claim a provider URL is replay-stable.
- Stable 400/401/403/404/409/413/422/503 mappings avoid provider/storage details. Upload expiry, a non-confirmable state, and operation/fingerprint conflicts all map to the public `file_center_operation_conflict` and HTTP `409`; the Controller does not inspect private Store state to distinguish them. Dependency failure and ambiguous protected lookup fail closed.

## Generated artifacts

- `contracts/generated/internal.openapi.json` includes the seven new internal operations.
- `contracts/generated/external.openapi.json` remains without these operations.
- `packages/api-client/src/index.ts` is regenerated from the internal bundle; `external.ts` remains unchanged.
- `contracts/generated/manifest.json` records the new deterministic hashes.

## Verification evidence

- `node --test scripts/check/permission-http-contracts.test.mjs`: 3/3 passed.
- `pnpm contracts:generate`: passed; five deterministic artifacts generated.
- `pnpm contracts:check`: passed; 28/28 workspace package contract checks.
- `pnpm --filter @ai-crm/api-client build`: passed.
- `pnpm --filter @ai-crm/api-client typecheck`: passed.
- `pnpm --filter @ai-crm/api-client lint`: passed.
- `pnpm repo:check`: passed, 40/40 repository tests.
- `git diff --check`: passed.
- Full `pnpm check`: the earlier aggregate passed this contract work but stopped on concurrent Worker findings. The Worker owner subsequently reported its lint/typecheck/build/contracts, 86/86 tests, and database integration all passing. The Integration Owner owns the final aggregate rerun after parallel work is stable; no Worker file was modified by this work package.

## Eight-area self-review

- Authorization: every operation is internal-only and catalog-bound; resource-owning services still perform current object/owner authorization. No UI visibility or FileReference grants access.
- Idempotency: durable file mutations require UUID keys and expose conflict semantics; read-only operations do not pretend to persist receipts; ephemeral download replay semantics are explicit.
- Transactions: contracts do not widen module transaction boundaries. File metadata/receipt state stays locally atomic and external grants/inspection remain outside database transactions.
- Migrations: no schema or migration changed; startup migration behavior is untouched.
- Observability/Audit: request bodies, submitted form data, storage/provider values, and URLs are not declared telemetry. Concrete adapters must preserve existing sanitized Audit/Trace behavior.
- Backward compatibility: additive internal paths, permission declarations, generated client operation entries, and schemas only; the external bundle is unchanged.
- Secrets: no Secret, Keycloak token, provider credential, storage identifier, or permanent URL is accepted or documented as a business fact.
- Failure modes: malformed input, missing/disabled targets, authorization denial, expired/conflicting upload state, unavailable dependencies, and non-compilable form release have bounded fail-closed responses.

## Independent review repair

The independent Reviewer reported three P2 contract findings. All were repaired without changing platform-module implementation:

1. Upload-session create replay no longer claims `original-result`: the contract and gate distinguish original durable identities from a freshly minted ephemeral grant bounded by the original session expiry.
2. Upload confirmation no longer exposes an unsupported `410` distinction. Expired, non-created, and fingerprint/state conflicts converge on the service's public `409` conflict capability.
3. Form validation's open `data` value now has explicit 262144-byte, depth-32, and 10000-node technical ceilings, a `413` response, and a gate requiring enforcement before authorization/service invocation.

## Remaining composition work

- API controllers must map the BFF principal to the module Actor, invoke current workforce/authorization/audit adapters, enforce CSRF/idempotency before service calls, and add controller/contract tests.
- Production remains Not Ready without a reviewed published non-empty authorization policy. This work does not seed one.
- A standalone File status polling endpoint requires a new public File Center query behavior and review; it must not query private Store/database types from `apps/api`.
