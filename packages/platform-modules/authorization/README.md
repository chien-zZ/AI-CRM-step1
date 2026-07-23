# Authorization

Owns a small, explicit, transport-neutral authorization core. Its public surface covers single checks, batch checks, and structured data-scope resolution. The first stage does not require Casbin, OpenFGA, OPA, or Cerbos; future engines remain behind adapters so domain modules never depend directly on a vendor.

Authentication success and Keycloak claims are inputs, not final business authorization decisions. This module remains authoritative for resource actions and future data-scope decisions. See [ADR-0004](../../../docs/08-架构决策/ADR-0004-Keycloak统一身份认证中心.md).

Function permissions and data scopes are separate. Data scopes are typed constraints rather than SQL fragments; the module that owns the data translates them into local queries and fails closed when it cannot enforce a constraint. Roles are configurable permission bundles and must not be hard-coded as authorization conditions.

Organization-derived grants should use effective assignments or explicit controlled exceptions rather than permanent grants inferred from a person's name or position text. Authorization consumes organization contracts and never queries organization tables.

External access distinguishes anonymous requests, restricted invitation capabilities, and authenticated Keycloak subjects. An invitation capability is not an identity and is never unioned with login permissions; see [ADR-0019](../../../docs/08-架构决策/ADR-0019-外部端分级访问与邀请授权.md).

See [ADR-0007](../../../docs/08-架构决策/ADR-0007-自研轻量业务授权核心.md).
