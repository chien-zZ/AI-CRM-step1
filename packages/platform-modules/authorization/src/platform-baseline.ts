import { canonicalizeAuthorizationPolicy } from "./postgres-persistence.js";
import type { AuthorizationPolicySnapshot, PermissionDeclaration } from "./types.js";

export interface PlatformPermissionCatalogEntry extends PermissionDeclaration {
  readonly owner: string;
}

export interface PlatformPermissionCatalog {
  readonly permissions: readonly PlatformPermissionCatalogEntry[];
  readonly version: 1;
}

export interface PlatformBaselinePolicyInput {
  readonly assignmentId: string;
  readonly catalog: PlatformPermissionCatalog;
  readonly grantId: string;
  readonly managementCatalog: PlatformPermissionCatalog;
  readonly roleId: string;
  readonly validFrom: string;
  readonly version: string;
}

/**
 * Builds the complete, business-neutral first-stage platform policy from the
 * reviewed permission catalog. Identity and immutable fact IDs are mandatory
 * release inputs; the repository never substitutes a synthetic production
 * person or assignment.
 */
export function createPlatformBaselineAuthorizationPolicy(
  input: PlatformBaselinePolicyInput,
): AuthorizationPolicySnapshot {
  const declarations = [...input.catalog.permissions, ...input.managementCatalog.permissions];
  if (declarations.length === 0) {
    return canonicalizeAuthorizationPolicy({ grants: [], permissions: [], roles: [], version: input.version });
  }
  const permissions = declarations.map(({ action, code, resource, scopeDimensions }) => ({
    action, code, resource, scopeDimensions: [...scopeDimensions],
  }));
  return canonicalizeAuthorizationPolicy({
    grants: [{
      grantId: input.grantId,
      roleId: input.roleId,
      subject: { assignmentId: input.assignmentId, kind: "assignment" },
      validFrom: input.validFrom,
    }],
    permissions,
    roles: [{
      permissions: permissions.map(({ code }) => ({
        permissionCode: code,
        scope: { terms: [{ kind: "all" }], version: 1 },
      })),
      roleId: input.roleId,
    }],
    version: input.version,
  });
}
