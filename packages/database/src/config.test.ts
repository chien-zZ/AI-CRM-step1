import { describe, expect, it } from "vitest";
import { validateDatabaseConfig } from "./config.js";

const valid = {
  applicationName: "ai_crm_test",
  connectionString: "postgresql://user:secret@localhost:5432/test_database",
  connectionTimeoutMs: 1_000,
  idleTimeoutMs: 10_000,
  maxConnections: 4,
  statementTimeoutMs: 5_000,
};

describe("validateDatabaseConfig", () => {
  it("accepts bounded PostgreSQL configuration", () => {
    expect(validateDatabaseConfig(valid)).toEqual(valid);
  });

  it("rejects non-PostgreSQL and unbounded pools", () => {
    expect(() => validateDatabaseConfig({ ...valid, connectionString: "https://example.test/db" })).toThrow();
    expect(() => validateDatabaseConfig({ ...valid, maxConnections: 101 })).toThrow();
  });
});
