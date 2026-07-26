import type { FormDraft, FormOutboxEvent, FormRelease } from "./types.js";
export interface FormSchemaStore {
  findDraft(definitionId: string): Promise<FormDraft | undefined>;
  findRelease(definitionId: string, releaseVersion: number): Promise<FormRelease | undefined>;
  publish(input: { readonly contentDigest: string; readonly definitionId: string; readonly event: FormOutboxEvent; readonly expectedRevision: number; readonly fingerprint: string; readonly operationId: string; readonly publishedAt: string }): Promise<{ readonly release: FormRelease; readonly replayed: boolean }>;
  saveDraft(input: { readonly draft: Omit<FormDraft, "revision">; readonly expectedRevision: number; readonly fingerprint: string; readonly operationId: string }): Promise<{ readonly draft: FormDraft; readonly replayed: boolean }>;
  setActive(input: { readonly active: boolean; readonly definitionId: string; readonly event: FormOutboxEvent; readonly fingerprint: string; readonly operationId: string; readonly releaseVersion: number }): Promise<{ readonly replayed: boolean }>;
}
export interface FormPersistenceResult<Row> { readonly rowCount: number; readonly rows: readonly Row[] }
export interface FormPersistenceRuntime { execute<Row = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<FormPersistenceResult<Row>>; withTransaction<T>(work: () => Promise<T>): Promise<T> }
