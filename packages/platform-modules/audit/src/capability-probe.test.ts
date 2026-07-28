import { describe, expect, it, vi } from "vitest";
import {
  createPostgresAuditCapabilityProbe,
  type AuditPersistenceRuntime,
} from "./index.js";

const completeRow = Object.freeze({
  advisory_lock_executable: true,
  hash_function_executable: true,
  operation_receipts_present: true,
  operation_receipts_privileges: true,
  records_present: true,
  records_privileges: true,
  schema_usage: true,
  transaction_read_write: true,
});
const incompleteRow = Object.fromEntries(Object.entries(completeRow).filter(([key]) => key !== "records_present"));

function runtime(result: { readonly rowCount: number; readonly rows: readonly unknown[] } = { rowCount: 1, rows: [completeRow] }): {
  readonly execute: ReturnType<typeof vi.fn>;
  readonly value: AuditPersistenceRuntime;
  readonly withTransaction: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn((sql: string) => {
    void sql;
    return Promise.resolve(result);
  });
  const withTransaction = vi.fn();
  return {
    execute,
    value: {
      execute: <Row = Record<string, unknown>>(sql: string) =>
        execute(sql) as Promise<{ readonly rowCount: number; readonly rows: readonly Row[] }>,
      withTransaction: async <T>(work: () => Promise<T>) => {
        withTransaction();
        return work();
      },
    },
    withTransaction,
  };
}

describe("PostgreSQL audit capability probe", () => {
  it("reports available only from one exact successful capability row without writing", async () => {
    const fixture = runtime();

    await expect(createPostgresAuditCapabilityProbe(fixture.value).check()).resolves.toEqual({ status: "available" });

    expect(fixture.execute).toHaveBeenCalledOnce();
    expect(fixture.execute).toHaveBeenCalledWith(expect.stringMatching(/^select\b/iu));
    expect(fixture.withTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["a false capability", { rowCount: 1, rows: [{ ...completeRow, schema_usage: false }] }],
    ["a null capability", { rowCount: 1, rows: [{ ...completeRow, records_present: null }] }],
    ["a wrongly typed capability", { rowCount: 1, rows: [{ ...completeRow, records_present: "true" }] }],
    ["a missing capability", { rowCount: 1, rows: [incompleteRow] }],
    ["an extra capability", { rowCount: 1, rows: [{ ...completeRow, writable: true }] }],
    ["an empty result", { rowCount: 0, rows: [] }],
    ["duplicate rows", { rowCount: 2, rows: [completeRow, completeRow] }],
    ["inconsistent row metadata", { rowCount: 0, rows: [completeRow] }],
  ])("fails closed for %s", async (_case, result) => {
    const fixture = runtime(result);
    await expect(createPostgresAuditCapabilityProbe(fixture.value).check()).resolves.toEqual({ status: "unavailable" });
    expect(fixture.withTransaction).not.toHaveBeenCalled();
  });

  it("fails closed when the capability query is unavailable", async () => {
    const fixture = runtime();
    fixture.execute.mockRejectedValueOnce(new Error("database detail must not escape"));

    await expect(createPostgresAuditCapabilityProbe(fixture.value).check()).resolves.toEqual({ status: "unavailable" });
    expect(fixture.withTransaction).not.toHaveBeenCalled();
  });
});
