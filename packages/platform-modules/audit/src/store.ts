import type { AuditRecord } from "./types.js";

export interface AuditAppend {
  readonly fingerprint: string;
  readonly record: AuditRecord;
}

export interface AuditStore {
  append(input: AuditAppend): Promise<{ readonly auditId: string; readonly replayed: boolean }>;
  findById(auditId: string): Promise<AuditRecord | undefined>;
}

export interface AuditPersistenceRuntime {
  execute<Row = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<AuditPersistenceResult<Row>>;
  withTransaction<T>(work: () => Promise<T>): Promise<T>;
}

export interface AuditPersistenceResult<Row> { readonly rowCount: number; readonly rows: readonly Row[] }
