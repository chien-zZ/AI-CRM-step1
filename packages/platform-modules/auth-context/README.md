# Auth Context

Validates Keycloak-issued OpenID Connect Access Tokens and converts external subjects into the internal, transport-neutral principal context. Validation includes issuer, a dedicated API resource audience, signature, expiry, and client binding, and must fail closed. The API audience is mapped only into Access Tokens; an ID Token for the same OAuth Client therefore cannot be substituted.

Trusted, client-specific BFF session adapters perform OIDC/provider and server-side session work before this normalized context reaches domain code. H5 clients use isolated HTTP-only cookies; the WeChat Mini Program uses only an opaque server-session handle. Cookies, session handles, provider identifiers, and Keycloak tokens are never accepted by domain modules directly.

This module does not implement passwords, MFA, token issuance, organization membership, or business authorization. Domain modules consume the normalized principal context through public contracts or `platform-sdk` and never depend on Keycloak directly.

See [ADR-0004](../../../docs/08-架构决策/ADR-0004-Keycloak统一身份认证中心.md).
See [ADR-0005](../../../docs/08-架构决策/ADR-0005-PC-Web采用BFF登录会话.md) for the PC Web session boundary.
Third-party identities are federated through Keycloak and never establish a parallel CRM authentication source; see [ADR-0006](../../../docs/08-架构决策/ADR-0006-第三方身份通过Keycloak联合接入.md).
Multi-client session and provider-adapter boundaries are defined by [ADR-0017](../../../docs/08-架构决策/ADR-0017-多客户端认证与服务端会话.md).
Internal subjects resolve through the organization boundary and fail closed without a unique workforce person and active employment; see [ADR-0018](../../../docs/08-架构决策/ADR-0018-内部人员主体关联与失效.md).
