import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { validateDatabaseConfig, type DatabaseConfig } from "./config.js";

export interface DatabaseHealth {
  readonly latencyMs: number;
  readonly status: "ready" | "unavailable";
}

export interface DatabaseRuntime {
  close(): Promise<void>;
  healthCheck(): Promise<DatabaseHealth>;
  withTransaction<T>(work: () => Promise<T>): Promise<T>;
}

interface RuntimeConnection {
  query(sql: string): Promise<unknown>;
  release(): void;
}

interface RuntimePool {
  connect(): Promise<RuntimeConnection>;
  end(): Promise<void>;
  query(sql: string): Promise<unknown>;
}

export class PostgresRuntime implements DatabaseRuntime {
  readonly #pool: RuntimePool;
  readonly #transaction = new AsyncLocalStorage<RuntimeConnection>();

  constructor(config: DatabaseConfig, pool?: RuntimePool) {
    const valid = validateDatabaseConfig(config);
    if (pool) {
      this.#pool = pool;
      return;
    }
    const postgresPool = new Pool({
      application_name: valid.applicationName,
      connectionString: valid.connectionString,
      connectionTimeoutMillis: valid.connectionTimeoutMs,
      idleTimeoutMillis: valid.idleTimeoutMs,
      max: valid.maxConnections,
      statement_timeout: valid.statementTimeoutMs,
    });
    drizzle(postgresPool);
    this.#pool = postgresPool;
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async healthCheck(): Promise<DatabaseHealth> {
    const started = performance.now();
    try {
      await this.#pool.query("select 1");
      return { latencyMs: performance.now() - started, status: "ready" };
    } catch {
      return { latencyMs: performance.now() - started, status: "unavailable" };
    }
  }

  async withTransaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.#transaction.getStore()) return work();
    const client = await this.#pool.connect();
    try {
      await client.query("begin");
      const result = await this.#transaction.run(client, work);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

export function createDatabaseRuntime(config: DatabaseConfig): DatabaseRuntime {
  return new PostgresRuntime(config);
}
