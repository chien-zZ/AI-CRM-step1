export interface DatabaseConfig {
  readonly applicationName: string;
  readonly connectionString: string;
  readonly connectionTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly maxConnections: number;
  readonly statementTimeoutMs: number;
}

export function validateDatabaseConfig(config: DatabaseConfig): DatabaseConfig {
  let url: URL;
  try {
    url = new URL(config.connectionString);
  } catch {
    throw new Error("Database connection string is invalid.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw new Error("Database connection string must identify a PostgreSQL host and database.");
  }
  if (!config.applicationName.match(/^[a-z][a-z0-9_-]{1,62}$/)) throw new Error("Database applicationName is invalid.");
  for (const [name, value] of Object.entries({
    connectionTimeoutMs: config.connectionTimeoutMs,
    idleTimeoutMs: config.idleTimeoutMs,
    maxConnections: config.maxConnections,
    statementTimeoutMs: config.statementTimeoutMs,
  })) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Database ${name} must be a positive integer.`);
  }
  if (config.maxConnections > 100) throw new Error("Database maxConnections exceeds the reviewed foundation limit.");
  return Object.freeze({ ...config });
}
