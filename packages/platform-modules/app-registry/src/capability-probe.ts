import type { AppRegistryPersistenceRuntime } from "./store.js";

export interface ApplicationRegistryCapabilityStatus {
  readonly status: "available" | "unavailable";
}

export interface ApplicationRegistryCapabilityProbe {
  check(): Promise<Readonly<ApplicationRegistryCapabilityStatus>>;
}

interface CapabilityRow {
  readonly applications_columns: boolean;
  readonly applications_present: boolean;
  readonly applications_select: boolean;
  readonly navigation_columns: boolean;
  readonly navigation_present: boolean;
  readonly navigation_select: boolean;
  readonly routes_columns: boolean;
  readonly routes_present: boolean;
  readonly routes_select: boolean;
  readonly schema_usage: boolean;
}

const capabilityKeys = [
  "applications_columns",
  "applications_present",
  "applications_select",
  "navigation_columns",
  "navigation_present",
  "navigation_select",
  "routes_columns",
  "routes_present",
  "routes_select",
  "schema_usage",
] as const satisfies readonly (keyof CapabilityRow)[];

const capabilityQuery = `select
  has_schema_privilege(current_user, 'app_registry', 'USAGE') as schema_usage,
  to_regclass('app_registry.applications') is not null as applications_present,
  coalesce((select count(*) = 4 from pg_catalog.pg_attribute a where a.attrelid = to_regclass('app_registry.applications') and a.attname = any(array['application_id','audience','enabled','permission_code']) and a.attnum > 0 and not a.attisdropped), false) as applications_columns,
  coalesce((select count(*) = 4 and bool_and(has_column_privilege(current_user, a.attrelid, a.attnum, 'SELECT')) from pg_catalog.pg_attribute a where a.attrelid = to_regclass('app_registry.applications') and a.attname = any(array['application_id','audience','enabled','permission_code']) and a.attnum > 0 and not a.attisdropped), false) as applications_select,
  to_regclass('app_registry.routes') is not null as routes_present,
  coalesce((select count(*) = 6 from pg_catalog.pg_attribute a where a.attrelid = to_regclass('app_registry.routes') and a.attname = any(array['route_id','application_id','path','enabled','permission_code','deep_link_sources']) and a.attnum > 0 and not a.attisdropped), false) as routes_columns,
  coalesce((select count(*) = 6 and bool_and(has_column_privilege(current_user, a.attrelid, a.attnum, 'SELECT')) from pg_catalog.pg_attribute a where a.attrelid = to_regclass('app_registry.routes') and a.attname = any(array['route_id','application_id','path','enabled','permission_code','deep_link_sources']) and a.attnum > 0 and not a.attisdropped), false) as routes_select,
  to_regclass('app_registry.navigation') is not null as navigation_present,
  coalesce((select count(*) = 6 from pg_catalog.pg_attribute a where a.attrelid = to_regclass('app_registry.navigation') and a.attname = any(array['navigation_id','application_id','route_id','parent_navigation_id','enabled','display_order']) and a.attnum > 0 and not a.attisdropped), false) as navigation_columns,
  coalesce((select count(*) = 6 and bool_and(has_column_privilege(current_user, a.attrelid, a.attnum, 'SELECT')) from pg_catalog.pg_attribute a where a.attrelid = to_regclass('app_registry.navigation') and a.attname = any(array['navigation_id','application_id','route_id','parent_navigation_id','enabled','display_order']) and a.attnum > 0 and not a.attisdropped), false) as navigation_select`;

const available = Object.freeze({ status: "available" as const });
const unavailable = Object.freeze({ status: "unavailable" as const });

function hasExactCapabilities(value: unknown): value is CapabilityRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value).sort();
  if (actualKeys.length !== capabilityKeys.length || actualKeys.some((key, index) => key !== capabilityKeys[index])) return false;
  const row = value as Record<string, unknown>;
  return capabilityKeys.every((key) => row[key] === true);
}

export function createPostgresApplicationRegistryCapabilityProbe(
  runtime: AppRegistryPersistenceRuntime,
): ApplicationRegistryCapabilityProbe {
  return Object.freeze({
    async check(): Promise<Readonly<ApplicationRegistryCapabilityStatus>> {
      try {
        const result = await runtime.execute<CapabilityRow>(capabilityQuery);
        if (result.rowCount !== 1 || result.rows.length !== 1 || !hasExactCapabilities(result.rows[0])) return unavailable;
        return available;
      } catch {
        return unavailable;
      }
    },
  });
}
