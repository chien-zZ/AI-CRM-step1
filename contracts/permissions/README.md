# Permission Catalog

Canonical permission codes, resource types, actions, ownership, and approved role mappings. Generated role matrices may be published here, but authentication credentials never belong here.

Permission declarations are owned by their platform or domain module and reviewed before implementation. Contracts keep function checks separate from structured data-scope resolution, contain no SQL or ORM fragments, and define stable deny/error semantics and policy-version context.

No CRM role, resource, action, or data-scope value may be added until its owning business boundary is confirmed. See [ADR-0007](../../docs/08-架构决策/ADR-0007-自研轻量业务授权核心.md).

External operations declare whether they accept anonymous, invitation-capability, or authenticated access. Invitation capabilities never declare a person identity and cannot be combined with login grants. See [ADR-0019](../../docs/08-架构决策/ADR-0019-外部端分级访问与邀请授权.md).

IAM-03 contract sources:

- `data-scope.v1.schema.json` defines a versioned union of explicit resource-wide terms or conjunctive dimension/value matches. It cannot carry SQL, ORM fragments, table names, scripts, or arbitrary operators.
- `authorization-policy.v1.schema.json` defines business-neutral permission declarations, role permission bundles, and effective Person/Assignment grants. The repository contains no real role or permission instance.
- `authorization-decision.v1.schema.json` defines allow/deny, stable reason, policy version, evaluation time, and a decision audit reference without exposing internal policy details.
