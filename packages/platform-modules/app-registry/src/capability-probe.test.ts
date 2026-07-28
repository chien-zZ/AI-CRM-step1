import { describe, expect, it, vi } from "vitest";

import {
  createPostgresApplicationRegistryCapabilityProbe,
  type AppRegistryPersistenceRuntime,
} from "./index.js";

const completeRow = Object.freeze({
  applications_columns: true,
  applications_present: true,
  applications_select: true,
  navigation_columns: true,
  navigation_present: true,
  navigation_select: true,
  routes_columns: true,
  routes_present: true,
  routes_select: true,
  schema_usage: true,
});

function fixture(result: { readonly rowCount: number; readonly rows: readonly unknown[] } = { rowCount: 1, rows: [completeRow] }): {
  readonly execute: ReturnType<typeof vi.fn>;
  readonly runtime: AppRegistryPersistenceRuntime;
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

describe("PostgreSQL Application Registry capability probe", () => {
  it("reports available from one exact capability row without reading module data or starting a transaction", async () => {
    const test = fixture();

    await expect(createPostgresApplicationRegistryCapabilityProbe(test.runtime).check()).resolves.toEqual({ status: "available" });

    expect(test.execute).toHaveBeenCalledOnce();
    expect(test.execute).toHaveBeenCalledWith(expect.stringMatching(/^select\b/iu), undefined);
    const sql: unknown = test.execute.mock.calls[0]?.[0];
    expect(typeof sql).toBe("string");
    if (typeof sql !== "string") throw new Error("Capability probe SQL was not recorded.");
    expect(sql).toContain("to_regclass('app_registry.applications')");
    expect(sql).toContain("array['application_id','audience','enabled','permission_code']");
    expect(sql).toContain("to_regclass('app_registry.routes')");
    expect(sql).toContain("array['route_id','application_id','path','enabled','permission_code','deep_link_sources']");
    expect(sql).toContain("to_regclass('app_registry.navigation')");
    expect(sql).toContain("array['navigation_id','application_id','route_id','parent_navigation_id','enabled','display_order']");
    expect(test.withTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing relation", { ...completeRow, routes_present: false }],
    ["a missing required column", { ...completeRow, navigation_columns: false }],
    ["missing SELECT capability", { ...completeRow, applications_select: false }],
    ["missing schema usage", { ...completeRow, schema_usage: false }],
    ["a null capability", { ...completeRow, routes_select: null }],
    ["a wrongly typed capability", { ...completeRow, routes_select: "true" }],
    ["a missing capability field", Object.fromEntries(Object.entries(completeRow).filter(([key]) => key !== "routes_select"))],
    ["an extra capability field", { ...completeRow, operation_receipts_select: true }],
  ])("fails closed for %s", async (_case, row) => {
    const test = fixture({ rowCount: 1, rows: [row] });
    await expect(createPostgresApplicationRegistryCapabilityProbe(test.runtime).check()).resolves.toEqual({ status: "unavailable" });
    expect(test.withTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty result", { rowCount: 0, rows: [] }],
    ["duplicate rows", { rowCount: 2, rows: [completeRow, completeRow] }],
    ["inconsistent row metadata", { rowCount: 0, rows: [completeRow] }],
  ])("fails closed for %s", async (_case, result) => {
    const test = fixture(result);
    await expect(createPostgresApplicationRegistryCapabilityProbe(test.runtime).check()).resolves.toEqual({ status: "unavailable" });
  });

  it("fails closed when PostgreSQL rejects or interrupts the catalog query", async () => {
    const test = fixture();
    test.execute.mockRejectedValueOnce(new Error("database detail must not escape"));

    await expect(createPostgresApplicationRegistryCapabilityProbe(test.runtime).check()).resolves.toEqual({ status: "unavailable" });
    expect(test.withTransaction).not.toHaveBeenCalled();
  });
});
