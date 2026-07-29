import { describe, expect, it } from "vitest";
import { PostgresRuntime } from "./runtime.js";

const config = {
  applicationName: "ai_crm_test",
  connectionString: "postgresql://user:secret@localhost:5432/test_database",
  connectionTimeoutMs: 1_000,
  idleTimeoutMs: 10_000,
  maxConnections: 4,
  statementTimeoutMs: 5_000,
};

function fixture(failHealth = false) {
  const statements: string[] = [];
  const releases: boolean[] = [];
  let ends = 0;
  let rejectPending: ((error: Error) => void) | undefined;
  const connection = {
    end() { ends += 1; rejectPending?.(new Error("connection destroyed")); return Promise.resolve(); },
    query(sql: string, values?: readonly unknown[]) {
      statements.push(`${sql}:${JSON.stringify(values ?? [])}`);
      if (sql === "select pending") return new Promise<never>((_resolve, reject) => { rejectPending = reject; });
      return Promise.resolve({ rowCount: 1, rows: [{ value: "ok" }] });
    },
    release(destroy = false) { releases.push(destroy); },
  };
  const pool = {
    connect() { return Promise.resolve(connection); },
    end() { return Promise.resolve(); },
    query() { return failHealth ? Promise.reject(new Error("unavailable")) : Promise.resolve({ rowCount: 0, rows: [] }); },
  };
  return { pool, ends: () => ends, releases, statements };
}

describe("PostgresRuntime", () => {
  it("commits nested work on one transaction and releases its connection", async () => {
    const state = fixture();
    const runtime = new PostgresRuntime(config, state.pool);
    await expect(runtime.withTransaction(() => runtime.withTransaction(() => Promise.resolve("done")))).resolves.toBe("done");
    expect(state.statements).toEqual(["begin:[]", "commit:[]"]);
    expect(state.releases).toEqual([false]);
  });

  it("rolls back failed work and preserves the original error", async () => {
    const state = fixture();
    const runtime = new PostgresRuntime(config, state.pool);
    await expect(runtime.withTransaction(() => Promise.reject(new Error("work failed")))).rejects.toThrow("work failed");
    expect(state.statements).toEqual(["begin:[]", "rollback:[]"]);
    expect(state.releases).toEqual([false]);
  });

  it("reports dependency health without leaking the connection error", async () => {
    const ready = new PostgresRuntime(config, fixture().pool);
    const unavailable = new PostgresRuntime(config, fixture(true).pool);
    await expect(ready.healthCheck()).resolves.toMatchObject({ status: "ready" });
    await expect(unavailable.healthCheck()).resolves.toMatchObject({ status: "unavailable" });
  });

  it("executes parameterized queries on the active transaction without exposing a transaction handle", async () => {
    const state = fixture(); const runtime = new PostgresRuntime(config, state.pool);
    await expect(runtime.withTransaction(() => runtime.execute<{ value: string }>("select $1::text value", ["synthetic"]))).resolves.toEqual({ rowCount: 1, rows: [{ value: "ok" }] });
    expect(state.statements).toEqual(["begin:[]", "select $1::text value:[\"synthetic\"]", "commit:[]"]);
  });

  it("rejects a pre-aborted operation without acquiring a connection", async () => {
    const state = fixture(); const runtime = new PostgresRuntime(config, state.pool); const controller = new AbortController(); controller.abort();
    await expect(runtime.execute("select pending", [], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    await expect(runtime.withTransaction(() => Promise.resolve("late"), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(state.statements).toEqual([]);
    expect(state.releases).toEqual([]);
  });

  it("destroys a dedicated connection when an active query is aborted", async () => {
    const state = fixture(); const runtime = new PostgresRuntime(config, state.pool); const controller = new AbortController();
    const query = runtime.execute("select pending", [], controller.signal);
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    controller.abort();
    await expect(query).rejects.toMatchObject({ name: "AbortError" });
    expect(state.ends()).toBe(1);
    expect(state.releases).toEqual([true]);
  });

  it("never commits and destroys the transaction connection after abort", async () => {
    const state = fixture(); const runtime = new PostgresRuntime(config, state.pool); const controller = new AbortController();
    const transaction = runtime.withTransaction(async () => {
      await runtime.execute("select pending", [], controller.signal);
      return "late";
    }, controller.signal);
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    controller.abort();
    await expect(transaction).rejects.toMatchObject({ name: "AbortError" });
    expect(state.statements).toEqual(["begin:[]", "select pending:[]"]);
    expect(state.ends()).toBe(1);
    expect(state.releases).toEqual([true]);
  });

  it("destroys the transaction when only an inner query signal is aborted", async () => {
    const state = fixture(); const runtime = new PostgresRuntime(config, state.pool); const controller = new AbortController();
    const transaction = runtime.withTransaction(async () => {
      const query = runtime.execute("select pending", [], controller.signal);
      await new Promise<void>((resolve) => { setImmediate(resolve); });
      controller.abort();
      await query;
    });
    await expect(transaction).rejects.toMatchObject({ name: "AbortError" });
    expect(state.statements).toEqual(["begin:[]", "select pending:[]"]);
    expect(state.ends()).toBe(1);
    expect(state.releases).toEqual([true]);
  });

  it("destroys the outer transaction for a pre-aborted nested transaction", async () => {
    const state = fixture(); const runtime = new PostgresRuntime(config, state.pool); const controller = new AbortController(); controller.abort();
    await expect(runtime.withTransaction(() => runtime.withTransaction(() => Promise.resolve("late"), controller.signal))).rejects.toMatchObject({ name: "AbortError" });
    expect(state.statements).toEqual(["begin:[]"]);
    expect(state.ends()).toBe(1);
    expect(state.releases).toEqual([true]);
  });

  it("cannot commit when work catches an inner cancellation", async () => {
    const state = fixture(); const runtime = new PostgresRuntime(config, state.pool); const controller = new AbortController(); controller.abort();
    await expect(runtime.withTransaction(async () => {
      await runtime.withTransaction(() => Promise.resolve("late"), controller.signal).catch(() => undefined);
      return "caught";
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(state.statements).toEqual(["begin:[]"]);
    expect(state.ends()).toBe(1);
    expect(state.releases).toEqual([true]);
  });

  it("cannot commit when work catches a failed query", async () => {
    const statements: string[] = [];
    const connection = {
      query(sql: string) {
        statements.push(sql);
        return sql === "select broken" ? Promise.reject(new Error("query failed")) : Promise.resolve({ rowCount: 0, rows: [] });
      },
      release() {},
    };
    const pool = { connect: () => Promise.resolve(connection), end: () => Promise.resolve(), query: () => Promise.resolve({ rowCount: 0, rows: [] }) };
    const runtime = new PostgresRuntime(config, pool);
    await expect(runtime.withTransaction(async () => {
      await runtime.execute("select broken").catch(() => undefined);
      return "incorrect-success";
    })).rejects.toThrow("query failed");
    expect(statements).toEqual(["begin", "select broken", "rollback"]);
  });
});
