import type { ContentVersion, FileLifecycleEvent, FileMetadata, ResourceLink, ResourceReference, UploadSession } from "./types.js";

export interface FileCenterStore {
  cleanupSession(input: { readonly fingerprint: string; readonly operationId: string; readonly sessionId: string }): Promise<{ readonly objectHandle: string; readonly replayed: boolean; readonly session: UploadSession }>;
  completeQuarantine(input: { readonly contentVersionId: string; readonly event: FileLifecycleEvent }): Promise<ContentVersion>;
  completeCleanup(sessionId: string): Promise<UploadSession>;
  completeUpload(input: { readonly checksumSha256?: string; readonly completedAt: string; readonly detectedMediaType?: string; readonly event: FileLifecycleEvent; readonly fingerprint: string; readonly operationId: string; readonly sessionId: string; readonly sizeBytes: number }): Promise<{ readonly contentVersion: ContentVersion; readonly replayed: boolean }>;
  createUpload(input: { readonly contentVersion: ContentVersion; readonly file: FileMetadata; readonly fingerprint: string; readonly objectHandle: string; readonly operationId: string; readonly session: UploadSession }): Promise<{ readonly contentVersion: ContentVersion; readonly file: FileMetadata; readonly objectHandle: string; readonly replayed: boolean; readonly session: UploadSession }>;
  createVersionUpload(input: { readonly contentVersion: Omit<ContentVersion, "versionNumber">; readonly fingerprint: string; readonly objectHandle: string; readonly operationId: string; readonly session: UploadSession }): Promise<{ readonly contentVersion: ContentVersion; readonly file: FileMetadata; readonly objectHandle: string; readonly replayed: boolean; readonly session: UploadSession }>;
  findContentVersion(contentVersionId: string): Promise<{ readonly contentVersion: ContentVersion; readonly file: FileMetadata; readonly objectHandle: string } | undefined>;
  findFile(fileId: string): Promise<FileMetadata | undefined>;
  findLink(linkId: string): Promise<ResourceLink | undefined>;
  findOperationReceipt(operationId: string, fingerprint: string): Promise<unknown>;
  findSession(sessionId: string): Promise<{ readonly contentVersion: ContentVersion; readonly file: FileMetadata; readonly objectHandle: string; readonly session: UploadSession } | undefined>;
  findActiveLink(fileId: string, contentVersionId: string, resource: ResourceReference): Promise<ResourceLink | undefined>;
  linkResource(input: { readonly event: FileLifecycleEvent; readonly fingerprint: string; readonly link: ResourceLink; readonly operationId: string }): Promise<{ readonly link: ResourceLink; readonly replayed: boolean }>;
  markReconciled(input: { readonly contentVersionId: string; readonly fingerprint: string; readonly objectExists: boolean; readonly operationId: string }): Promise<{ readonly contentVersion: ContentVersion; readonly replayed: boolean }>;
  recordScan(input: { readonly contentVersionId: string; readonly event?: FileLifecycleEvent; readonly fingerprint: string; readonly operationId: string; readonly outcome: "clean" | "malicious" | "unscannable"; readonly scannedAt: string; readonly scannerVersion: string }): Promise<{ readonly contentVersion: ContentVersion; readonly objectHandle: string; readonly replayed: boolean }>;
  unlinkResource(input: { readonly event: FileLifecycleEvent; readonly fingerprint: string; readonly operationId: string; readonly unlinkedAt: string; readonly linkId: string }): Promise<{ readonly link: ResourceLink; readonly replayed: boolean }>;
}
export interface FileCenterPersistenceResult<Row> { readonly rowCount: number; readonly rows: readonly Row[] }
export interface FileCenterPersistenceRuntime { execute<Row = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<FileCenterPersistenceResult<Row>>; withTransaction<T>(work: () => Promise<T>): Promise<T> }
