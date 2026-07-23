# Organization

Owns workforce people, employments, organization units, positions, and effective-dated assignments. Business-specific territories, customer ownership, and performance rules do not belong here.

An authenticated Keycloak or federated identity does not automatically imply an active organization membership or position. Keycloak owns provider federation, while this module owns the effective association from a Keycloak `issuer + sub` to one workforce person. A missing or conflicting association, or an inactive employment, fails closed.

Transfers, concurrent assignments, and departures close and create effective-dated facts instead of overwriting history. Keycloak, WeCom, and future HR systems remain behind synchronization adapters and are not the organization model exposed to consumers.

See [ADR-0008](../../../docs/08-架构决策/ADR-0008-自研有效期化人员与组织模型.md), [ADR-0018](../../../docs/08-架构决策/ADR-0018-内部人员主体关联与失效.md), and the [module description](../../../docs/03-模块说明/组织模块.md).
