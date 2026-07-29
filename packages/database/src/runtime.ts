import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool, type ClientConfig } from "pg";
import { validateDatabaseConfig, type DatabaseConfig } from "./config.js";

export interface DatabaseHealth {
  readonly latencyMs: number;
  readonly status: "ready" | "unavailable";
}

export interface DatabaseRuntime {
  readonly abortSignalSupport?: true;
  close(): Promise<void>;
  execute<Row = Record<string, unknown>>(sql: string, values?: readonly unknown[], signal?: AbortSignal): Promise<DatabaseQueryResult<Row>>;
  healthCheck(): Promise<DatabaseHealth>;
  withTransaction<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

export interface DatabaseQueryResult<Row = Record<string, unknown>> {
  readonly rowCount: number;
  readonly rows: readonly Row[];
}

interface RuntimeConnection {
  readonly end?: () => Promise<void>;
  readonly processID?: number;
  query(sql: string, values?: readonly unknown[]): Promise<{ readonly rowCount?: number | null; readonly rows?: readonly unknown[] }>;
  release(destroy?: boolean): void;
}

function terminateConnection(connection: RuntimeConnection): void {
  // PoolClient inherits Client.end at runtime although @types/pg omits it from PoolClient.
  void connection.end?.().catch(() => undefined);
  connection.release(true);
}

interface RuntimePool {
  connect(): Promise<RuntimeConnection>;
  end(): Promise<void>;
  query(sql: string, values?: readonly unknown[]): Promise<{ readonly rowCount?: number | null; readonly rows?: readonly unknown[] }>;
}

interface TransactionState {
  readonly connection: RuntimeConnection;
  cancellation?: Promise<void>;
  destroyed: boolean;
  failure?: Error;
  destroy(): void;
}

const transactionDestroyed = (state: TransactionState): boolean => state.destroyed;

export class PostgresRuntime implements DatabaseRuntime {
  public readonly abortSignalSupport = true as const;
  readonly #clientConfig: ClientConfig;
  readonly #pool: RuntimePool;
  readonly #transaction = new AsyncLocalStorage<TransactionState>();

  constructor(config: DatabaseConfig, pool?: RuntimePool) {
    const valid = validateDatabaseConfig(config);
    this.#clientConfig = {
      application_name: valid.applicationName,
      connectionString: valid.connectionString,
      connectionTimeoutMillis: valid.connectionTimeoutMs,
      statement_timeout: valid.statementTimeoutMs,
    };
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

  async #cancelAndTerminate(connection: RuntimeConnection): Promise<void> {
    const processId = connection.processID;
    if (!Number.isSafeInteger(processId) || (processId ?? 0) < 1) {
      terminateConnection(connection);
      return;
    }
    const canceller = new Client(this.#clientConfig);
    try {
      await canceller.connect();
      await canceller.query<{ cancelled: boolean }>("select pg_cancel_backend($1) cancelled", [processId]);
    } catch {
      // Closing the owned connection below is the fail-closed cancellation path.
    } finally {
      await canceller.end().catch(() => undefined);
      terminateConnection(connection);
    }
  }

  async execute<Row = Record<string, unknown>>(sql: string, values?: readonly unknown[], signal?: AbortSignal): Promise<DatabaseQueryResult<Row>> {
    const transaction = this.#transaction.getStore();
    if (transaction !== undefined) {
      if (transaction.destroyed) throw abortError();
      if (signal?.aborted === true) {
        transaction.destroy();
        signal.throwIfAborted();
      }
      const abort = (): void => { transaction.destroy(); };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const result = await transaction.connection.query(sql, values);
        signal?.throwIfAborted();
        return { rowCount: result.rowCount ?? 0, rows: (result.rows ?? []) as readonly Row[] };
      } catch (error) {
        transaction.failure ??= error instanceof Error ? error : new Error("database_query_failed");
        signal?.throwIfAborted();
        if (transactionDestroyed(transaction)) throw abortError();
        throw error;
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    }
    signal?.throwIfAborted();
    if (signal === undefined) {
      const result = await this.#pool.query(sql, values);
      return { rowCount: result.rowCount ?? 0, rows: (result.rows ?? []) as readonly Row[] };
    }
    const connection = await this.#pool.connect();
    if (signal.aborted) {
      terminateConnection(connection);
      throw abortError();
    }
    const released = new Set<RuntimeConnection>();
    let cancellation: Promise<void> | undefined;
    const abort = (): void => {
      if (released.has(connection)) return;
      released.add(connection);
      cancellation = this.#cancelAndTerminate(connection);
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const result = await connection.query(sql, values);
      signal.throwIfAborted();
      return { rowCount: result.rowCount ?? 0, rows: (result.rows ?? []) as readonly Row[] };
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      await cancellation;
      if (!released.has(connection)) connection.release();
    }
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

  async withTransaction<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const transaction = this.#transaction.getStore();
    if (transaction !== undefined) {
      if (transaction.destroyed) throw abortError();
      if (signal?.aborted === true) {
        transaction.destroy();
        signal.throwIfAborted();
      }
      const abort = (): void => { transaction.destroy(); };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const result = await work();
        signal?.throwIfAborted();
        return result;
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    }
    signal?.throwIfAborted();
    const client = await this.#pool.connect();
    const destroy = (): void => {
      if (state.destroyed) return;
      state.destroyed = true;
      state.cancellation = this.#cancelAndTerminate(client);
    };
    const state: TransactionState = { connection: client, destroyed: false, destroy };
    if (signal?.aborted === true) {
      terminateConnection(client);
      throw abortError();
    }
    signal?.addEventListener("abort", destroy, { once: true });
    try {
      await client.query("begin");
      signal?.throwIfAborted();
      const result = await this.#transaction.run(state, work);
      signal?.throwIfAborted();
      if (state.destroyed) {
        await state.cancellation;
        throw abortError();
      }
      if (state.failure !== undefined) throw state.failure;
      await client.query("commit");
      return result;
    } catch (error) {
      if (!state.destroyed) {
        try { await client.query("rollback"); }
        catch { state.destroy(); }
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", destroy);
      await state.cancellation;
      if (!state.destroyed) client.release();
    }
  }
}

function abortError(): Error {
  return new DOMException("The database operation was aborted.", "AbortError");
}

export function createDatabaseRuntime(config: DatabaseConfig): DatabaseRuntime {
  return new PostgresRuntime(config);
}
