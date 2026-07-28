import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabaseRuntime } from "./runtime.js";

const urlFile = process.env.TEST_DATABASE_MIGRATION_URL_FILE;

describe.skipIf(!urlFile)("PostgreSQL runtime cancellation", () => {
  it("terminates the active statement, rolls back, and keeps the pool usable", async () => {
    if (!urlFile) throw new Error("TEST_DATABASE_MIGRATION_URL_FILE is required for this integration test.");
    const connectionString = (await readFile(resolve(urlFile), "utf8")).trim();
    const table = `database_abort_probe_${randomUUID().replaceAll("-", "")}`;
    const runtime = createDatabaseRuntime({
      applicationName: "database_abort_integration",
      connectionString,
      connectionTimeoutMs: 5_000,
      idleTimeoutMs: 5_000,
      maxConnections: 2,
      statementTimeoutMs: 30_000,
    });
    try {
      await runtime.execute(`create table ${table}(value integer not null)`);
      const controller = new AbortController();
      let backendPid: number | undefined;
      const transaction = runtime.withTransaction(async () => {
        const backend = await runtime.execute<{ pid: number }>("select pg_backend_pid() pid", [], controller.signal);
        backendPid = backend.rows[0]?.pid;
        await runtime.execute(`insert into ${table}(value) values(1)`, [], controller.signal);
        await runtime.execute("select pg_sleep(30)", [], controller.signal);
      }, controller.signal);
      const started = Date.now();
      const timer = setTimeout(() => { controller.abort(); }, 100);
      try {
        await expect(transaction).rejects.toBeDefined();
      } finally {
        clearTimeout(timer);
      }
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(backendPid).toBeTypeOf("number");
      await expect(runtime.execute<{ count: string }>("select count(*)::text count from pg_stat_activity where pid=$1", [backendPid]))
        .resolves.toEqual({ rowCount: 1, rows: [{ count: "0" }] });
      await expect(runtime.execute<{ count: string }>(`select count(*)::text count from ${table}`))
        .resolves.toEqual({ rowCount: 1, rows: [{ count: "0" }] });
      await expect(runtime.execute("select 1")).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await runtime.execute(`drop table if exists ${table}`);
      await runtime.close();
    }
  }, 40_000);
});
