import type { DatabaseQueryResult } from "./runtime.js";

export interface RuntimeRoleCapabilityStatus {
  readonly status: "available" | "unavailable";
}

export interface RuntimeRoleCapabilityProbe {
  check(): Promise<Readonly<RuntimeRoleCapabilityStatus>>;
}

export interface RuntimeRoleCapabilityRuntime {
  execute<Row = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<DatabaseQueryResult<Row>>;
}

interface CapabilityRow {
  readonly bypassrls_denied: boolean;
  readonly createdb_denied: boolean;
  readonly createrole_denied: boolean;
  readonly database_create_denied: boolean;
  readonly exact_runtime_role: boolean;
  readonly login_enabled: boolean;
  readonly public_schema_create_denied: boolean;
  readonly public_schema_usage_denied: boolean;
  readonly replication_denied: boolean;
  readonly role_membership_denied: boolean;
  readonly superuser_denied: boolean;
  readonly temporary_denied: boolean;
}

const capabilityKeys = [
  "bypassrls_denied",
  "createdb_denied",
  "createrole_denied",
  "database_create_denied",
  "exact_runtime_role",
  "login_enabled",
  "public_schema_create_denied",
  "public_schema_usage_denied",
  "replication_denied",
  "role_membership_denied",
  "superuser_denied",
  "temporary_denied",
] as const satisfies readonly (keyof CapabilityRow)[];

const capabilityQuery = (expectedRole: "ai_crm_runtime" | "ai_crm_worker_runtime") => `select
  current_user = '${expectedRole}' as exact_runtime_role,
  role.rolcanlogin as login_enabled,
  not role.rolsuper as superuser_denied,
  not role.rolcreatedb as createdb_denied,
  not role.rolcreaterole as createrole_denied,
  not role.rolreplication as replication_denied,
  not role.rolbypassrls as bypassrls_denied,
  not exists(select 1 from pg_catalog.pg_auth_members membership where membership.member=role.oid) as role_membership_denied,
  not has_database_privilege(current_user,current_database(),'CREATE') as database_create_denied,
  not has_database_privilege(current_user,current_database(),'TEMP') as temporary_denied,
  not has_schema_privilege(current_user,'public','CREATE') as public_schema_create_denied,
  not has_schema_privilege(current_user,'public','USAGE') as public_schema_usage_denied
from pg_catalog.pg_roles role
where role.rolname=current_user`;

const available = Object.freeze({ status: "available" as const });
const unavailable = Object.freeze({ status: "unavailable" as const });

function hasExactCapabilities(value: unknown): value is CapabilityRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actualKeys = Object.keys(descriptors).sort();
  if (actualKeys.length !== capabilityKeys.length || actualKeys.some((key, index) => key !== capabilityKeys[index])) return false;
  return capabilityKeys.every((key) => {
    const descriptor = descriptors[key];
    return descriptor !== undefined && descriptor.get === undefined && descriptor.set === undefined &&
      descriptor.enumerable && descriptor.value === true;
  });
}

export function createPostgresRuntimeRoleCapabilityProbe(
  runtime: RuntimeRoleCapabilityRuntime,
): RuntimeRoleCapabilityProbe {
  return createFixedRoleCapabilityProbe(runtime, "ai_crm_runtime");
}

export function createPostgresWorkerRuntimeRoleCapabilityProbe(
  runtime: RuntimeRoleCapabilityRuntime,
): RuntimeRoleCapabilityProbe {
  return createFixedRoleCapabilityProbe(runtime, "ai_crm_worker_runtime");
}

function createFixedRoleCapabilityProbe(
  runtime: RuntimeRoleCapabilityRuntime,
  expectedRole: "ai_crm_runtime" | "ai_crm_worker_runtime",
): RuntimeRoleCapabilityProbe {
  return Object.freeze({
    async check(): Promise<Readonly<RuntimeRoleCapabilityStatus>> {
      try {
        const result = await runtime.execute<CapabilityRow>(capabilityQuery(expectedRole));
        if (result.rowCount !== 1 || result.rows.length !== 1 || !hasExactCapabilities(result.rows[0])) {
          return unavailable;
        }
        return available;
      } catch {
        return unavailable;
      }
    },
  });
}
