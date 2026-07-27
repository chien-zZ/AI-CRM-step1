export const packageId = "@ai-crm/database" as const;
export { validateDatabaseConfig, type DatabaseConfig } from "./config.js";
export { createDatabaseRuntime, type DatabaseHealth, type DatabaseQueryResult, type DatabaseRuntime } from "./runtime.js";
export {
  checkMigrationCompatibility,
  checkMigrationCompatibilityWithPool,
  type MigrationCompatibilityIssue,
  type MigrationCompatibilityReport,
} from "./migration-compatibility.js";
export {
  loadMigrations,
  runMigrations,
  type ApplicationCompatibility,
  type MigrationDefinition,
  type MigrationMetadata,
} from "./migrations.js";
