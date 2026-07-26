# Database Infrastructure

Shared PostgreSQL connection, Drizzle transaction, migration, health-check, observability, and test utilities. Each module owns its PostgreSQL schema area, Drizzle Schema, repositories, and mappings; this package must not become a cross-module query layer or a registry of all application tables.

Public exports must not expose module table definitions or provide a generic repository that bypasses ownership. Application startup never mutates database schemas; reviewed SQL migrations run as a separate deployment step with dedicated credentials.

`DatabaseRuntime` exposes parameterized `execute` and nested `withTransaction` operations without exposing a PostgreSQL client, Drizzle query builder, or transaction handle. Modules that must atomically commit local state and an Outbox/Inbox fact share one runtime instance and enter one outer `withTransaction` boundary.

The root `pnpm db:migrate` command discovers versioned SQL migrations under `packages/database/migrations` and each `packages/platform-modules/*/migrations` directory, then applies the combined list in global version order under the migration lock. Module `migrate` commands remain available for isolated ownership tests; deployment uses the root command.

See [ADR-0011](../../docs/08-架构决策/ADR-0011-PostgreSQL与Drizzle数据持久化基线.md) and the [database migration baseline](../../docs/04-工程手册/数据库与迁移基线.md).
