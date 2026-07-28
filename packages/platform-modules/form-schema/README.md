# Form Schema

Owns business-neutral JSON Schema 2020-12 form definition identities, drafts, immutable releases, controlled UI Schema, and validation contracts. Server-side Ajv validation is authoritative; the PC Web renderer uses a whitelist of Ant Design and ProComponents fields.

Confirmed business forms remain semantically owned by their domain modules, and submitted values remain in the owning domain. This module stores published runtime artifacts and stable version references, not business submissions.

Workflow instances reference versioned form definitions or approved snapshots; Flowable variables do not become a duplicate form or business-data store.

See [ADR-0013](../../../docs/08-架构决策/ADR-0013-版本化表单与业务配置中心.md) and the [module description](../../../docs/03-模块说明/表单定义模块.md).

`createPostgresFormSchemaQueryService` is the production read/validation boundary. Every call carries an explicit authenticated Actor, current workforce authorization subject, and request Trace. It authorizes the exact definition and immutable release before reading the module-owned PostgreSQL Store. Validation reads the exact release, persists no submitted value, and retains the existing controlled server-side dialect and stable failure semantics.
