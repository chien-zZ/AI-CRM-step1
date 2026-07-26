export interface FileActor { readonly actorId: string; readonly actorType: "authenticated_subject" | "system"; readonly assignmentId?: string }
export interface FileReference { readonly contentVersionId: string; readonly displayName: string; readonly fileId: string; readonly mediaType?: string; readonly sizeBytes?: number; readonly version: 1 }
export interface FileMetadata { readonly classificationReference?: string; readonly createdAt: string; readonly displayName: string; readonly fileId: string; readonly ownerModule: string; readonly uploadedBy: FileActor; readonly version: 1 }
export type ContentVersionStatus = "awaiting_upload" | "pending_scan" | "available" | "quarantine_pending" | "quarantined" | "object_missing" | "cleanup_pending" | "deleted";
export interface ContentVersion { readonly actualSizeBytes?: number; readonly checksumSha256?: string; readonly completedAt?: string; readonly contentVersionId: string; readonly createdAt: string; readonly declaredMediaType: string; readonly declaredSizeBytes: number; readonly detectedMediaType?: string; readonly fileId: string; readonly scannedAt?: string; readonly status: ContentVersionStatus; readonly version: 1; readonly versionNumber: number }
export type UploadSessionStatus = "created" | "pending_scan" | "expired" | "cleanup_pending" | "cleaned";
export interface UploadSession { readonly contentVersionId: string; readonly createdAt: string; readonly expiresAt: string; readonly fileId: string; readonly sessionId: string; readonly status: UploadSessionStatus; readonly version: 1 }
export interface ResourceReference { readonly resourceId: string; readonly resourceType: string }
export interface ResourceLink { readonly contentVersionId: string; readonly fileId: string; readonly linkedAt: string; readonly linkId: string; readonly ownerModule: string; readonly relationType: string; readonly resource: ResourceReference; readonly unlinkedAt?: string; readonly version: 1 }
export interface UploadGrant { readonly expiresAt: string; readonly headers: Readonly<Record<string, string>>; readonly method: "PUT"; readonly uploadUrl: string; readonly version: 1 }
export interface DownloadGrant { readonly downloadUrl: string; readonly expiresAt: string; readonly fileReference: FileReference; readonly version: 1 }
export interface StorageObjectMetadata { readonly checksumSha256?: string; readonly detectedMediaType?: string; readonly exists: boolean; readonly sizeBytes?: number }
export interface StorageAdapter {
  createDownloadGrant(input: { readonly contentDisposition: string; readonly expiresAt: string; readonly objectHandle: string }): Promise<{ readonly url: string }>;
  createUploadGrant(input: { readonly declaredMediaType: string; readonly declaredSizeBytes: number; readonly expiresAt: string; readonly objectHandle: string }): Promise<{ readonly headers?: Readonly<Record<string, string>>; readonly url: string }>;
  deleteObject(input: { readonly objectHandle: string }): Promise<void>;
  inspectObject(input: { readonly objectHandle: string }): Promise<StorageObjectMetadata>;
  quarantineObject(input: { readonly objectHandle: string }): Promise<void>;
  readObject(input: { readonly maximumBytes: number; readonly objectHandle: string }): Promise<Uint8Array>;
}
export interface MalwareScanner { scan(input: { readonly bytes: Uint8Array; readonly maximumBytes: number }): Promise<{ readonly outcome: "clean" | "malicious" | "unscannable"; readonly scannerVersion: string }> }
export interface FileAuthorizationRequest { readonly action: "file:cleanup" | "file:download" | "file:link" | "file:reconcile" | "file:scan" | "file:upload"; readonly actor: FileActor; readonly ownerModule?: string; readonly resourceReference: string }
export interface FileAuthorizer { authorize(input: FileAuthorizationRequest): Promise<{ readonly allowed: boolean; readonly decisionId: string }> }
export interface FileAudit { record(input: { readonly action: string; readonly actor: FileActor; readonly authorizationDecisionId: string; readonly operationId: string; readonly reason: string; readonly resourceReference: string; readonly result: "attempted" | "denied" | "failed" | "succeeded"; readonly traceId: string }): Promise<void> }
export interface FileLifecycleEvent { readonly eventId: string; readonly eventType: "file.content.available" | "file.content.quarantined" | "file.resource.linked" | "file.resource.unlinked" | "file.upload.completed"; readonly occurredAt: string; readonly resourceId: string; readonly version: 1 }
export interface FileCommandMetadata { readonly actor: FileActor; readonly operationId: string; readonly reason: string; readonly traceId: string }
export interface CreateUploadSessionCommand extends FileCommandMetadata { readonly classificationReference?: string; readonly declaredMediaType: string; readonly declaredSizeBytes: number; readonly displayName: string; readonly ownerModule: string }
export interface CreateContentVersionUploadCommand extends FileCommandMetadata { readonly declaredMediaType: string; readonly declaredSizeBytes: number; readonly fileId: string }
export interface CompleteUploadCommand extends FileCommandMetadata { readonly sessionId: string }
export interface ScanContentCommand extends FileCommandMetadata { readonly contentVersionId: string }
export interface LinkResourceCommand extends FileCommandMetadata { readonly fileReference: FileReference; readonly linkId: string; readonly ownerModule: string; readonly relationType: string; readonly resource: ResourceReference }
export interface UnlinkResourceCommand extends FileCommandMetadata { readonly linkId: string }
export interface FileCenterService {
  authorizeDownload(input: { readonly actor: FileActor; readonly fileReference: FileReference; readonly operationId: string; readonly reason: string; readonly resource: ResourceReference; readonly traceId: string }): Promise<DownloadGrant>;
  cleanupUploadSession(command: FileCommandMetadata & { readonly sessionId: string }): Promise<{ readonly cleaned: boolean; readonly replayed: boolean }>;
  completeUpload(command: CompleteUploadCommand): Promise<{ readonly contentVersion: ContentVersion; readonly replayed: boolean }>;
  createContentVersionUpload(command: CreateContentVersionUploadCommand): Promise<{ readonly fileReference: FileReference; readonly replayed: boolean; readonly session: UploadSession; readonly uploadGrant: UploadGrant }>;
  createUploadSession(command: CreateUploadSessionCommand): Promise<{ readonly fileReference: FileReference; readonly replayed: boolean; readonly session: UploadSession; readonly uploadGrant: UploadGrant }>;
  linkResource(command: LinkResourceCommand): Promise<{ readonly link: ResourceLink; readonly replayed: boolean }>;
  reconcileContentVersion(command: FileCommandMetadata & { readonly contentVersionId: string }): Promise<{ readonly contentVersion: ContentVersion; readonly replayed: boolean }>;
  scanContentVersion(command: ScanContentCommand): Promise<{ readonly contentVersion: ContentVersion; readonly replayed: boolean }>;
  unlinkResource(command: UnlinkResourceCommand): Promise<{ readonly link: ResourceLink; readonly replayed: boolean }>;
}
