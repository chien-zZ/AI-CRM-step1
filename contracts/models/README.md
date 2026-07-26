# Shared Contract Models

Business-neutral JSON Schemas such as principal context, organization references, resource references, money, pagination, trace context, and file references.

Organization references distinguish authentication subjects, workforce people, employments, organization units, positions, and effective-dated assignments. Shared contracts expose identifiers and time-aware references, not organization database rows or vendor directory objects. Internal subject associations are effective-dated and expose no WeCom provider identifier; see [ADR-0008](../../docs/08-架构决策/ADR-0008-自研有效期化人员与组织模型.md) and [ADR-0018](../../docs/08-架构决策/ADR-0018-内部人员主体关联与失效.md).

`workforce-context.v1.schema.json` describes the transport-neutral result of resolving an authenticated internal subject at an explicit time. It deliberately contains no display attributes, provider directory identifiers, roles, permissions, or implicit primary assignment.

File references expose stable file and optional content-version identifiers plus approved display metadata. They never expose a storage bucket, object key, credential, provider SDK model, or permanent URL. Download access is resolved just in time through the file center. See [ADR-0012](../../docs/08-架构决策/ADR-0012-自研文件中心与腾讯云COS对象存储.md).

Concrete fields and enums are added only after their module contracts are reviewed; no CRM person or customer model belongs in this shared directory.
