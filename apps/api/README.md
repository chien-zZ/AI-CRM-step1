# API Application

NestJS composition root for synchronous HTTP APIs and optional real-time delivery. It wires platform and confirmed domain modules together but must not contain domain logic itself.

It is separated from `apps/worker` so HTTP latency, connection handling, scaling, health, and failure behavior can be managed independently from retries and long-running jobs. This separation does not require platform or domain packages to be deployed as microservices.

This application hosts isolated BFF authentication boundaries for the approved clients. PC Web and both H5 artifacts receive only opaque, secure, HTTP-only cookies; the WeChat Mini Program receives only a short-lived, revocable opaque session handle. Keycloak tokens and provider secrets remain server-side, and the BFF does not issue its own authentication JWT. See [ADR-0005](../../docs/08-架构决策/ADR-0005-PC-Web采用BFF登录会话.md) and [ADR-0017](../../docs/08-架构决策/ADR-0017-多客户端认证与服务端会话.md).

Reviewed synchronous provider adapters and Webhook entry adapters are composed here when a real integration is approved. Webhooks must verify the raw request and durably register the receipt before asynchronous business processing; this application does not own provider business state or expose a generic arbitrary-URL proxy. No concrete third-party adapter is part of the first-stage scope. See [ADR-0020](../../docs/08-架构决策/ADR-0020-第三方集成运行时与供应商适配器.md).

This process uses the project observability boundary for Pino JSON logs, safe Trace Context propagation, Sentry error reporting, and liveness/readiness checks. It never logs or reports credentials, sessions, request bodies, personal data, or raw provider payloads. See [ADR-0022](../../docs/08-架构决策/ADR-0022-第一阶段轻量可观测性基线.md).

Future approved synchronous AI adapters are composed here only for use cases that must return an immediate proposal within a strict deadline. Clients cannot submit arbitrary system prompts, choose unapproved providers, invoke tools, or turn model output into a domain command. The first stage has no real model adapter. See [ADR-0024](../../docs/08-架构决策/ADR-0024-AI网关与AI治理边界.md).

See [ADR-0003](../../docs/08-架构决策/ADR-0003-Monorepo应用与模块边界.md).

## PC BFF authentication configuration

The IAM-01 adapter requires explicit configuration; it does not provide session-duration or security-key defaults:

- `AI_CRM_KEYCLOAK_ISSUER`, `AI_CRM_PC_OIDC_CLIENT_ID`, `AI_CRM_OIDC_API_AUDIENCE`, `AI_CRM_PC_OIDC_REDIRECT_URI`, `AI_CRM_PC_ALLOWED_ORIGIN`
- `AI_CRM_PC_LOGIN_TRANSACTION_TTL_SECONDS`, `AI_CRM_PC_SESSION_IDLE_TTL_SECONDS`, `AI_CRM_PC_SESSION_ABSOLUTE_TTL_SECONDS`
- `AI_CRM_PC_OIDC_TIMEOUT_SECONDS`, `AI_CRM_PC_REFRESH_LEASE_TTL_MS`, `AI_CRM_REDIS_CONNECT_TIMEOUT_MS`, `AI_CRM_REDIS_URL`
- `AI_CRM_PC_OIDC_CLIENT_SECRET_FILE`, `AI_CRM_REDIS_PASSWORD_FILE`
- `AI_CRM_PC_SESSION_ENCRYPTION_KEY_FILE`, `AI_CRM_PC_SESSION_ENCRYPTION_KEY_ID`, `AI_CRM_PC_SESSION_INDEX_KEY_FILE`
- Optional bounded rotation pair: `AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_FILE`, `AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_ID`

The current session-encryption and indexing keys are distinct 256-bit base64url values. Secret values are read only from the referenced files. During encryption-key rotation, configure exactly one previous ID/file pair: the current key writes every new or refreshed envelope, while the previous key is read-only. Keep the previous file mounted for no longer than the configured absolute session TTL after all consumers switch to the current key, then remove both previous-key settings and revoke the old file. Duplicate IDs, duplicate values, incomplete pairs, and reuse of the indexing key fail closed. Rotating the indexing key intentionally invalidates all existing browser credentials and is not an online session-preserving operation.

Redis stores short-lived login transactions and encrypted Token sets; session lookup keys are keyed digests rather than browser credentials. Redis, Keycloak, decryption, Access Token verification, or durable authentication-audit failures fail closed.

The OAuth Client ID and API resource Audience are separate values. The development/test Realm maps `ai-crm-api` only into Access Tokens; the verifier also binds `azp` to the PC BFF Client ID. This rejects ID Token substitution without adding business claims.

The CMP-01 application root now starts a NestJS HTTP application and exposes the reviewed `/health/live` and `/health/ready` contract. Required dependencies are supplied explicitly by the composition caller; an unavailable required dependency returns `503` without exposing dependency names or topology. Authentication and platform facades remain injected through their public entry points as their controllers are registered; the composition root does not create repositories or domain rules.

Process configuration is parsed through `@ai-crm/config`. The reviewed defaults bind container traffic on `0.0.0.0:3000`; `AI_CRM_API_HOST` is restricted to reviewed local/container bind addresses, `AI_CRM_API_PORT` must be a valid TCP port, and `AI_CRM_RELEASE` is a bounded immutable release identifier. These settings do not make the API ready until its required module dependencies are composed and healthy.

### Authentication integration test

Run `pnpm auth:test:integration` from the repository root with Docker available. The runner creates an isolated PostgreSQL/Redis/Keycloak project, generates temporary Secret files, creates a random synthetic Keycloak user through the Admin API, and verifies Authorization Code + PKCE, callback exchange, JWKS principal verification, Redis-backed session creation, refresh rotation, old-session invalidation, and logout. It always removes the synthetic user, containers, Volumes, networks, and temporary Secret directory.

The default loopback ports are `18080` for Keycloak and `16379` for Redis. Set `AI_CRM_TEST_KEYCLOAK_PORT` and `AI_CRM_TEST_REDIS_PORT` to unused explicit ports when needed. These variables contain ports only; Secret values remain file-backed and are never placed in the environment or command arguments.

The Realm import is bootstrap-only: Keycloak skips an import when the Realm already exists. For an existing local/test Realm, rotate the confidential PC Client with `pnpm auth:rotate-client-secret` after setting `AI_CRM_KEYCLOAK_ISSUER`, `AI_CRM_PC_OIDC_CLIENT_ID`, `AI_CRM_PC_OIDC_CLIENT_SECRET_FILE`, `AI_CRM_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME`, `AI_CRM_KEYCLOAK_BOOTSTRAP_ADMIN_SECRET_FILE`, and the bounded `AI_CRM_KEYCLOAK_ADMIN_TIMEOUT_SECONDS`. The command reads both credentials from restricted files, restricts and closes the temporary file before changing Keycloak, updates and verifies Keycloak, and uses atomic rename as its final commit step. Pre-commit failures roll Keycloak back and remove the temporary file. Stop or restart API consumers around this single-version rotation maintenance window. Test-server and production rotation remains an OPS-owned procedure and must not reuse the development bootstrap administrator.
