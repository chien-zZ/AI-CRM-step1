# HTTP Contracts

Store one OpenAPI source document per owning module. Files in this directory are the editable HTTP contract sources.

Every operation intended for an external client must be explicitly classified for the external audience. CI generates a separate external allowlist bundle; unclassified or internal operations never enter that bundle by default.

Each external operation also declares exactly which access mode it accepts: anonymous, invitation capability, or authenticated Keycloak session. Missing classification defaults to authenticated-and-denied-until-authorized. A single request must not union invitation and login grants. Invitation schemas are added only with their first confirmed business owner and resource; see [ADR-0019](../../docs/08-架构决策/ADR-0019-外部端分级访问与邀请授权.md).
