# Permission Catalog

Canonical permission codes, resource types, actions, ownership, and approved role mappings. Generated role matrices may be published here, but authentication credentials never belong here.

Permission declarations are owned by their platform or domain module and reviewed before implementation. Contracts keep function checks separate from structured data-scope resolution, contain no SQL or ORM fragments, and define stable deny/error semantics and policy-version context.

No CRM role, resource, action, or data-scope value may be added until its owning business boundary is confirmed. See [ADR-0007](../../docs/08-架构决策/ADR-0007-自研轻量业务授权核心.md).

External operations declare whether they accept anonymous, invitation-capability, or authenticated access. Invitation capabilities never declare a person identity and cannot be combined with login grants. See [ADR-0019](../../docs/08-架构决策/ADR-0019-外部端分级访问与邀请授权.md).
