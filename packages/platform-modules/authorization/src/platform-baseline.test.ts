import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { AuthorizationPersistenceError } from "./errors.js";
import { createPlatformBaselineAuthorizationPolicy, type PlatformPermissionCatalog } from "./platform-baseline.js";

const input = async () => ({
  assignmentId: "70000000-0000-4000-8000-000000000001",
  catalog: JSON.parse(await readFile(new URL("../../../../contracts/permissions/platform-permission-catalog.v1.json", import.meta.url), "utf8")) as PlatformPermissionCatalog,
  grantId: "70000000-0000-4000-8000-000000000002",
  managementCatalog: JSON.parse(await readFile(new URL("../../../../contracts/permissions/platform-management-permission-catalog.v1.json", import.meta.url), "utf8")) as PlatformPermissionCatalog,
  roleId: "70000000-0000-4000-8000-000000000003",
  validFrom: "2026-07-29T00:00:00.000Z",
  version: "platform-baseline-v1",
});

describe("platform baseline authorization policy", () => {
  it("turns every reviewed platform permission into one complete assignment-scoped baseline", async () => {
    const source = await input();
    const snapshot = createPlatformBaselineAuthorizationPolicy(source);
    expect(snapshot.permissions).toHaveLength(source.catalog.permissions.length + source.managementCatalog.permissions.length);
    expect(snapshot.permissions).toContainEqual(expect.objectContaining({ code: "platform.authorization.policy:publish" }));
    expect(snapshot.roles).toEqual([{ permissions: snapshot.permissions.map(({ code }) => ({
      permissionCode: code, scope: { terms: [{ kind: "all" }], version: 1 },
    })), roleId: source.roleId }]);
    expect(snapshot.grants).toEqual([{
      grantId: source.grantId, roleId: source.roleId,
      subject: { assignmentId: source.assignmentId, kind: "assignment" }, validFrom: source.validFrom,
    }]);
  });

  it("fails closed for an empty, inconsistent, or invalid release input", async () => {
    const source = await input();
    expect(() => createPlatformBaselineAuthorizationPolicy({ ...source, catalog: { permissions: [], version: 1 }, managementCatalog: { permissions: [], version: 1 } }))
      .toThrow(AuthorizationPersistenceError);
    const first = source.catalog.permissions[0]; if (!first) throw new Error("catalog fixture");
    expect(() => createPlatformBaselineAuthorizationPolicy({
      ...source, catalog: { permissions: [{ ...first, code: `${first.resource}:wrong` }], version: 1 },
    })).toThrow(AuthorizationPersistenceError);
    expect(() => createPlatformBaselineAuthorizationPolicy({ ...source, assignmentId: "not-an-assignment" }))
      .toThrow(AuthorizationPersistenceError);
  });
});
