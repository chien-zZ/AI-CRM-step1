# Database Infrastructure

Shared PostgreSQL connection, Drizzle transaction, migration, health-check, observability, and test utilities. Each module owns its PostgreSQL schema area, Drizzle Schema, repositories, and mappings; this package must not become a cross-module query layer or a registry of all application tables.

Public exports must not expose module table definitions or provide a generic repository that bypasses ownership. Application startup never mutates database schemas; reviewed SQL migrations run as a separate deployment step with dedicated credentials.

## Startup compatibility check

Applications may call the public `checkMigrationCompatibility` API with a runtime/read-only PostgreSQL connection, the complete release migration-directory catalog, and an independently governed `applicationSchemaVersion` in strict `x.y.z` form. The schema version is not a release/build identifier: values such as the four-segment `AI_CRM_RELEASE_ID=2026.07.26.1` must never be passed as `applicationSchemaVersion`. The check issues exactly one `SELECT` against `ai_crm_migrations.applied_migrations`; it does not acquire the migration lock, start a transaction, execute SQL migrations, or write migration state. It fails closed in its report when a required migration is missing, an applied migration is unknown to the release, registry identity/checksum differs, or the application schema version is outside an applied migration's declared range. Database/query failures are thrown so the composition root can mark startup/readiness unavailable without mistaking an unavailable check for compatibility.

New migration metadata must express `applicationCompatibility` as `{ "minimumInclusive": "x.y.z", "maximumExclusive": "x.y.z" }`, with `maximumExclusive` optional. To preserve already reviewed metadata and SQL unchanged, the loader explicitly adapts the historical `">=0.0.0"` value and the three repository-existing additive declarations to `{ "minimumInclusive": "0.0.0" }`; it rejects every other free-text value. The canonical object behavior is covered by test fixtures rather than a rewrite of historical metadata. A release must include the complete migration metadata catalog: an older release that cannot describe a later applied migration fails closed instead of guessing rollback safety.

`DatabaseRuntime` exposes parameterized `execute` and nested `withTransaction` operations without exposing a PostgreSQL client, Drizzle query builder, or transaction handle. Modules that must atomically commit local state and an Outbox/Inbox fact share one runtime instance and enter one outer `withTransaction` boundary.

The root `pnpm db:migrate` command discovers versioned SQL migrations under `packages/database/migrations` and each `packages/platform-modules/*/migrations` directory, then applies the combined list in global version order under the migration lock. Module `migrate` commands remain available for isolated ownership tests; deployment uses the root command.

See [ADR-0011](../../docs/08-架构决策/ADR-0011-PostgreSQL与Drizzle数据持久化基线.md) and the [database migration baseline](../../docs/04-工程手册/数据库与迁移基线.md).
