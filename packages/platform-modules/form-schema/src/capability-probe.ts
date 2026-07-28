import type { FormPersistenceRuntime } from "./store.js";

export interface FormSchemaCapabilityStatus {
  readonly status: "available" | "unavailable";
}

export interface FormSchemaCapabilityProbe {
  check(): Promise<Readonly<FormSchemaCapabilityStatus>>;
}

interface CapabilityRow {
  readonly release_status_columns: boolean;
  readonly release_status_present: boolean;
  readonly release_status_select: boolean;
  readonly releases_columns: boolean;
  readonly releases_present: boolean;
  readonly releases_select: boolean;
  readonly schema_usage: boolean;
}

const capabilityKeys = [
  "release_status_columns",
  "release_status_present",
  "release_status_select",
  "releases_columns",
  "releases_present",
  "releases_select",
  "schema_usage",
] as const satisfies readonly (keyof CapabilityRow)[];

const capabilityQuery = `select
  has_schema_privilege(current_user, 'form_schema', 'USAGE') as schema_usage,
  to_regclass('form_schema.releases') is not null as releases_present,
  coalesce((select count(*) = 7 from pg_catalog.pg_attribute a where a.attrelid = to_regclass('form_schema.releases') and a.attname = any(array['definition_id','release_version','owner_module','content_digest','json_schema','ui_schema','published_at']) and a.attnum > 0 and not a.attisdropped), false) as releases_columns,
  coalesce((select count(*) = 7 and bool_and(has_column_privilege(current_user, a.attrelid, a.attnum, 'SELECT')) from pg_catalog.pg_attribute a where a.attrelid = to_regclass('form_schema.releases') and a.attname = any(array['definition_id','release_version','owner_module','content_digest','json_schema','ui_schema','published_at']) and a.attnum > 0 and not a.attisdropped), false) as releases_select,
  to_regclass('form_schema.release_status') is not null as release_status_present,
  coalesce((select count(*) = 3 from pg_catalog.pg_attribute a where a.attrelid = to_regclass('form_schema.release_status') and a.attname = any(array['definition_id','release_version','active']) and a.attnum > 0 and not a.attisdropped), false) as release_status_columns,
  coalesce((select count(*) = 3 and bool_and(has_column_privilege(current_user, a.attrelid, a.attnum, 'SELECT')) from pg_catalog.pg_attribute a where a.attrelid = to_regclass('form_schema.release_status') and a.attname = any(array['definition_id','release_version','active']) and a.attnum > 0 and not a.attisdropped), false) as release_status_select`;

const available = Object.freeze({ status: "available" as const });
const unavailable = Object.freeze({ status: "unavailable" as const });

function hasExactCapabilities(value: unknown): value is CapabilityRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value).sort();
  if (actualKeys.length !== capabilityKeys.length || actualKeys.some((key, index) => key !== capabilityKeys[index])) return false;
  const row = value as Record<string, unknown>;
  return capabilityKeys.every((key) => row[key] === true);
}

export function createPostgresFormSchemaCapabilityProbe(runtime: FormPersistenceRuntime): FormSchemaCapabilityProbe {
  return Object.freeze({
    async check(): Promise<Readonly<FormSchemaCapabilityStatus>> {
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
