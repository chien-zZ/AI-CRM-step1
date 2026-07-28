# HTTP Contracts

Store one OpenAPI source document per owning module. Files in this directory are the editable HTTP contract sources.

Every operation intended for an external client must be explicitly classified for the external audience. CI generates a separate external allowlist bundle; unclassified or internal operations never enter that bundle by default.

Each external operation also declares exactly which access mode it accepts: anonymous, invitation capability, or authenticated Keycloak session. Missing classification defaults to authenticated-and-denied-until-authorized. A single request must not union invitation and login grants. Invitation schemas are added only with their first confirmed business owner and resource; see [ADR-0019](../../docs/08-架构决策/ADR-0019-外部端分级访问与邀请授权.md).

Protected platform operations declare one reviewed `x-ai-crm-permission` binding and an exact internal/external audience. Operations introduced after the BFF session baseline also declare `x-ai-crm-csrf` and `x-ai-crm-idempotency` semantics. `required` CSRF means both the session-bound `X-CSRF-Token` and the trusted `Origin`/`Referer` check are mandatory. A read-only POST may explicitly declare CSRF not required, but that declaration does not make it externally accessible or bypass current authorization.

`Idempotency-Key` values map to bounded UUID operation identities. `required` with `original-result` means an identical semantic retry replays the durable operation and changed-payload reuse returns `409`. File upload-session creation instead declares `original-identities` plus a freshly minted ephemeral grant bounded by the original durable session expiry; it never claims provider grant bytes or URLs are replay-stable. `audit-operation-only` identifies one logical audited access but does not promise an identical ephemeral provider grant on retry. GET and server-only read/validation operations explicitly declare `none`.

Operations accepting structurally open JSON declare transport limits through `x-ai-crm-request-limits`. The BFF Controller enforces the byte ceiling before parsing and enforces depth/node ceilings before authorization and service invocation. Exceeding any declared ceiling returns `413` without logging or forwarding the submitted value.

The current business-neutral HTTP platform surface includes Application Registry internal snapshot/deep-link resolution, immutable Form release read/server validation, and File Center initial upload session/confirmation/short-lived download grants. File malware scanning, cleanup, quarantine, reconciliation, storage handles, and provider topology remain internal. Business Configuration has no reviewed HTTP surface in this package and is intentionally not mixed into Form Schema.
