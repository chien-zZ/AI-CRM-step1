# Migration Scripts

Drizzle SQL migration validation and execution, resumable data backfills, drift checks, and recovery tooling. Destructive or irreversible operations require explicit approval, compatibility analysis, a tested recovery or forward-fix path, and an observable stopping condition.

Migrations run separately from application startup with dedicated DDL credentials and global mutual exclusion. Shared environments never use automatic schema synchronization or `drizzle-kit push`.

See [ADR-0011](../../docs/08-架构决策/ADR-0011-PostgreSQL与Drizzle数据持久化基线.md) and the [database migration baseline](../../docs/04-工程手册/数据库与迁移基线.md).
