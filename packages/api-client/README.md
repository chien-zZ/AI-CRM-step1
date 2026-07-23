# Generated API Client

Generated from reviewed OpenAPI sources and CI-generated audience bundles. Generated files are not edited manually.

Internal and external clients are separate artifacts. `external-portal` can import only the allowlisted external client; it must never bundle the complete internal API surface. Endpoint models are transport-neutral, with Fetch and Taro request transports injected by their owning applications.

Generated external operations preserve their reviewed anonymous, invitation, or authenticated access classification. The client may transport a selected mode but never infers permission or combines invitation and login grants.

See [ADR-0016](../../docs/08-架构决策/ADR-0016-Taro内部移动端与外部多端技术栈.md) and [ADR-0019](../../docs/08-架构决策/ADR-0019-外部端分级访问与邀请授权.md).
