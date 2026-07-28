import type { AuditPersistenceRuntime } from "./store.js";

export interface AuditCapabilityStatus {
  readonly status: "available" | "unavailable";
}

export interface AuditCapabilityProbe {
  check(): Promise<Readonly<AuditCapabilityStatus>>;
}

interface CapabilityRow {
  readonly advisory_lock_executable: boolean;
  readonly hash_function_executable: boolean;
  readonly operation_receipts_present: boolean;
  readonly operation_receipts_privileges: boolean;
  readonly records_present: boolean;
  readonly records_privileges: boolean;
  readonly schema_usage: boolean;
  readonly transaction_read_write: boolean;
}

const capabilityKeys = [
  "advisory_lock_executable",
  "hash_function_executable",
  "operation_receipts_present",
  "operation_receipts_privileges",
  "records_present",
  "records_privileges",
  "schema_usage",
  "transaction_read_write",
] as const satisfies readonly (keyof CapabilityRow)[];

const capabilityQuery = `select
  current_setting('transaction_read_only') = 'off' as transaction_read_write,
  has_schema_privilege(current_user, 'audit', 'USAGE') as schema_usage,
  to_regclass('audit.records') is not null as records_present,
  to_regclass('audit.operation_receipts') is not null as operation_receipts_present,
  has_table_privilege(current_user, 'audit.records', 'SELECT,INSERT') as records_privileges,
  has_table_privilege(current_user, 'audit.operation_receipts', 'SELECT,INSERT,UPDATE') as operation_receipts_privileges,
  has_function_privilege(current_user, 'pg_catalog.hashtextextended(text,bigint)', 'EXECUTE') as hash_function_executable,
  has_function_privilege(current_user, 'pg_catalog.pg_advisory_xact_lock(bigint)', 'EXECUTE') as advisory_lock_executable`;

const available = Object.freeze({ status: "available" as const });
const unavailable = Object.freeze({ status: "unavailable" as const });

function hasExactCapabilities(value: unknown): value is CapabilityRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value).sort();
  if (actualKeys.length !== capabilityKeys.length || actualKeys.some((key, index) => key !== capabilityKeys[index])) return false;
  const row = value as Record<string, unknown>;
  return capabilityKeys.every((key) => row[key] === true);
}

export function createPostgresAuditCapabilityProbe(runtime: AuditPersistenceRuntime): AuditCapabilityProbe {
  return Object.freeze({
    async check(): Promise<Readonly<AuditCapabilityStatus>> {
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
