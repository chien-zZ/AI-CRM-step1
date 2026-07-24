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
  let releases = 0;
  const connection = {
    query(sql: string) { statements.push(sql); return Promise.resolve({}); },
    release() { releases += 1; },
  };
  const pool = {
    connect() { return Promise.resolve(connection); },
    end() { return Promise.resolve(); },
    query() { return failHealth ? Promise.reject(new Error("unavailable")) : Promise.resolve({}); },
  };
  return { pool, releases: () => releases, statements };
}

describe("PostgresRuntime", () => {
  it("commits nested work on one transaction and releases its connection", async () => {
    const state = fixture();
    const runtime = new PostgresRuntime(config, state.pool);
    await expect(runtime.withTransaction(() => runtime.withTransaction(() => Promise.resolve("done")))).resolves.toBe("done");
    expect(state.statements).toEqual(["begin", "commit"]);
    expect(state.releases()).toBe(1);
  });

  it("rolls back failed work and preserves the original error", async () => {
    const state = fixture();
    const runtime = new PostgresRuntime(config, state.pool);
    await expect(runtime.withTransaction(() => Promise.reject(new Error("work failed")))).rejects.toThrow("work failed");
    expect(state.statements).toEqual(["begin", "rollback"]);
    expect(state.releases()).toBe(1);
  });

  it("reports dependency health without leaking the connection error", async () => {
    const ready = new PostgresRuntime(config, fixture().pool);
    const unavailable = new PostgresRuntime(config, fixture(true).pool);
    await expect(ready.healthCheck()).resolves.toMatchObject({ status: "ready" });
    await expect(unavailable.healthCheck()).resolves.toMatchObject({ status: "unavailable" });
  });
});
