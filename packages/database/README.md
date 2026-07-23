# Database Infrastructure

Shared PostgreSQL connection, Drizzle transaction, migration, health-check, observability, and test utilities. Each module owns its PostgreSQL schema area, Drizzle Schema, repositories, and mappings; this package must not become a cross-module query layer or a registry of all application tables.

Public exports must not expose module table definitions or provide a generic repository that bypasses ownership. Application startup never mutates database schemas; reviewed SQL migrations run as a separate deployment step with dedicated credentials.

See [ADR-0011](../../docs/08-架构决策/ADR-0011-PostgreSQL与Drizzle数据持久化基线.md) and the [database migration baseline](../../docs/04-工程手册/数据库与迁移基线.md).
