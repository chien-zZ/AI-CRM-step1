export const packageId = "@ai-crm/database" as const;
export { validateDatabaseConfig, type DatabaseConfig } from "./config.js";
export { createDatabaseRuntime, type DatabaseHealth, type DatabaseQueryResult, type DatabaseRuntime } from "./runtime.js";
export { loadMigrations, runMigrations, type MigrationDefinition, type MigrationMetadata } from "./migrations.js";
