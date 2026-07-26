# Organization

Owns workforce people, employments, organization units, positions, and effective-dated assignments. Business-specific territories, customer ownership, and performance rules do not belong here.

An authenticated Keycloak or federated identity does not automatically imply an active organization membership or position. Keycloak owns provider federation, while this module owns the effective association from a Keycloak `issuer + sub` to one workforce person. A missing or conflicting association, or an inactive employment, fails closed.

Transfers, concurrent assignments, and departures close and create effective-dated facts instead of overwriting history. Keycloak, WeCom, and future HR systems remain behind synchronization adapters and are not the organization model exposed to consumers.

See [ADR-0008](../../../docs/08-架构决策/ADR-0008-自研有效期化人员与组织模型.md), [ADR-0018](../../../docs/08-架构决策/ADR-0018-内部人员主体关联与失效.md), and the [module description](../../../docs/03-模块说明/组织模块.md).

## Public Boundary

The package root exports transport-neutral IDs, half-open effective intervals, stable errors, the `OrganizationServiceApi`, and factories for memory or PostgreSQL composition. The PostgreSQL factory accepts a module-specific ambient-transaction persistence runtime; it never exports Drizzle tables, database rows, query builders, or transaction handles. Stores and write representations remain package-private so callers cannot bypass the service authorization boundary through the public entry point.

`resolveWorkforceContext` requires an explicit evaluation time. It fails closed for no association, conflicting association, or no active Employment. Multiple active Assignments are returned as separate contexts; callers may request one explicit Assignment ID, but the service never selects an implicit first Assignment.

The resolver is a server-internal capability and accepts only the already verified `issuer + sub` produced by the authentication boundary; it is not an endpoint for resolving arbitrary client-submitted subjects. `createMemoryOrganizationService` is limited to tests and synthetic fixtures and must not be used as a production fact store.

Every write command requires an idempotency operation ID plus actor, reason, and trace references. `OrganizationCommandAuthorizer` is mandatory and runs before persistence; it carries operation semantics but defines no roles or permission codes. A store commit includes the state mutation, operation receipt, audit intent, and transport-neutral event intent in one local transaction. Reusing an operation ID with different content is rejected.

## Persistence And Migration

The private Drizzle Schema and PostgreSQL adapter live inside this package. Migration `0000000002_organization_effective_dated_core` is additive and creates only the `organization` schema. PostgreSQL triggers serialize and reject overlapping effective subject associations and unit placements; composite foreign keys prevent an Assignment from referencing another person's Employment or a Position from another unit.

Application rollback leaves the additive schema and history in place. Recovery or repairs use a reviewed forward migration; populated organization history must not be dropped as a routine rollback.

After the shared migration registry has been applied, build this package and run `DATABASE_MIGRATION_URL_FILE=<path> pnpm --filter @ai-crm/platform-organization migrate` as a dedicated deployment step. `pnpm --filter @ai-crm/platform-organization test:integration` starts an isolated PostgreSQL 17.5 container with a temporary file-mounted Secret, runs migration and transaction acceptance, and removes the container and temporary files.
