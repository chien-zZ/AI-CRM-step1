import { describe, expect, it, vi } from "vitest";

import {
  createPostgresFormSchemaCapabilityProbe,
  type FormPersistenceRuntime,
} from "./index.js";

const completeRow = Object.freeze({
  release_status_columns: true,
  release_status_present: true,
  release_status_select: true,
  releases_columns: true,
  releases_present: true,
  releases_select: true,
  schema_usage: true,
});

function fixture(result: { readonly rowCount: number; readonly rows: readonly unknown[] } = { rowCount: 1, rows: [completeRow] }): {
  readonly execute: ReturnType<typeof vi.fn>;
  readonly runtime: FormPersistenceRuntime;
  readonly withTransaction: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn((sql: string, values?: readonly unknown[]) => {
    void sql;
    void values;
    return Promise.resolve(result);
  });
  const withTransaction = vi.fn();
  return {
    execute,
    runtime: {
      execute: <Row = Record<string, unknown>>(sql: string, values?: readonly unknown[]) => {
        return execute(sql, values) as Promise<{ readonly rowCount: number; readonly rows: readonly Row[] }>;
      },
      withTransaction: async <T>(work: () => Promise<T>) => {
        withTransaction();
        return work();
      },
    },
    withTransaction,
  };
}

describe("PostgreSQL Form Schema capability probe", () => {
  it("reports available from one exact capability row without reading form data or starting a transaction", async () => {
    const test = fixture();

    await expect(createPostgresFormSchemaCapabilityProbe(test.runtime).check()).resolves.toEqual({ status: "available" });

    expect(test.execute).toHaveBeenCalledOnce();
    expect(test.execute).toHaveBeenCalledWith(expect.stringMatching(/^select\b/iu), undefined);
    const sql: unknown = test.execute.mock.calls[0]?.[0];
    expect(typeof sql).toBe("string");
    if (typeof sql !== "string") throw new Error("Capability probe SQL was not recorded.");
    expect(sql).toContain("to_regclass('form_schema.releases')");
    expect(sql).toContain("array['definition_id','release_version','owner_module','content_digest','json_schema','ui_schema','published_at']");
    expect(sql).toContain("to_regclass('form_schema.release_status')");
    expect(sql).toContain("array['definition_id','release_version','active']");
    expect(test.withTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing relation", { ...completeRow, releases_present: false }],
    ["a missing required column", { ...completeRow, release_status_columns: false }],
    ["missing SELECT capability", { ...completeRow, releases_select: false }],
    ["missing schema usage", { ...completeRow, schema_usage: false }],
    ["a null capability", { ...completeRow, release_status_select: null }],
    ["a wrongly typed capability", { ...completeRow, release_status_select: "true" }],
    ["a missing capability field", Object.fromEntries(Object.entries(completeRow).filter(([key]) => key !== "release_status_select"))],
    ["an extra capability field", { ...completeRow, drafts_select: true }],
  ])("fails closed for %s", async (_case, row) => {
    const test = fixture({ rowCount: 1, rows: [row] });
    await expect(createPostgresFormSchemaCapabilityProbe(test.runtime).check()).resolves.toEqual({ status: "unavailable" });
    expect(test.withTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty result", { rowCount: 0, rows: [] }],
    ["duplicate rows", { rowCount: 2, rows: [completeRow, completeRow] }],
    ["inconsistent row metadata", { rowCount: 0, rows: [completeRow] }],
  ])("fails closed for %s", async (_case, result) => {
    const test = fixture(result);
    await expect(createPostgresFormSchemaCapabilityProbe(test.runtime).check()).resolves.toEqual({ status: "unavailable" });
  });

  it("fails closed when PostgreSQL rejects or interrupts the catalog query", async () => {
    const test = fixture();
    test.execute.mockRejectedValueOnce(new Error("database detail must not escape"));

    await expect(createPostgresFormSchemaCapabilityProbe(test.runtime).check()).resolves.toEqual({ status: "unavailable" });
    expect(test.withTransaction).not.toHaveBeenCalled();
  });
});
