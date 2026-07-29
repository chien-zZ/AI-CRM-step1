import { describe, expect, it, vi } from "vitest";
import { createPostgresRuntimeRoleCapabilityProbe, createPostgresWorkerRuntimeRoleCapabilityProbe, type RuntimeRoleCapabilityRuntime } from "./runtime-role-capability.js";

const exactCapabilities = Object.freeze({
  bypassrls_denied: true,
  createdb_denied: true,
  createrole_denied: true,
  database_create_denied: true,
  exact_runtime_role: true,
  login_enabled: true,
  public_schema_create_denied: true,
  public_schema_usage_denied: true,
  replication_denied: true,
  role_membership_denied: true,
  superuser_denied: true,
  temporary_denied: true,
});

function runtime(rows: readonly unknown[], rowCount = rows.length): RuntimeRoleCapabilityRuntime {
  return { execute: vi.fn().mockResolvedValue({ rowCount, rows }) };
}

describe("PostgreSQL runtime-role capability probe", () => {
  it("accepts only the fixed ai_crm_runtime least-privilege result", async () => {
    const value = runtime([exactCapabilities]);
    await expect(createPostgresRuntimeRoleCapabilityProbe(value).check()).resolves.toEqual({ status: "available" });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(value.execute).toHaveBeenCalledWith(expect.stringContaining("current_user = 'ai_crm_runtime'"));
  });

  it("accepts only the fixed ai_crm_worker_runtime least-privilege result for Worker", async () => {
    const value = runtime([exactCapabilities]);
    await expect(createPostgresWorkerRuntimeRoleCapabilityProbe(value).check()).resolves.toEqual({ status: "available" });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(value.execute).toHaveBeenCalledWith(expect.stringContaining("current_user = 'ai_crm_worker_runtime'"));
  });

  it("fails closed for false, missing, additional, or accessor-backed capabilities", async () => {
    const getter = Object.defineProperty({ ...exactCapabilities }, "superuser_denied", { enumerable: true, get: () => true });
    for (const row of [
      { ...exactCapabilities, superuser_denied: false },
      Object.fromEntries(Object.entries(exactCapabilities).slice(1)),
      { ...exactCapabilities, unexpected: true },
      getter,
    ]) {
      await expect(createPostgresRuntimeRoleCapabilityProbe(runtime([row])).check())
        .resolves.toEqual({ status: "unavailable" });
    }
  });

  it("fails closed for query errors and invalid cardinality", async () => {
    await expect(createPostgresRuntimeRoleCapabilityProbe({ execute: () => Promise.reject(new Error("unavailable")) }).check())
      .resolves.toEqual({ status: "unavailable" });
    await expect(createPostgresRuntimeRoleCapabilityProbe(runtime([], 0)).check())
      .resolves.toEqual({ status: "unavailable" });
    await expect(createPostgresRuntimeRoleCapabilityProbe(runtime([exactCapabilities, exactCapabilities], 2)).check())
      .resolves.toEqual({ status: "unavailable" });
  });
});
