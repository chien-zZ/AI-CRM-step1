import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { FileCenterError, MemoryFileCenterStore, createFileCenterService, type FileAudit, type FileAuthorizer, type MalwareScanner, type StorageAdapter, type StorageObjectMetadata } from "./index.js";

const actor = { actorId: "system.synthetic", actorType: "system" as const };
const traceId = "1234567890abcdef1234567890abcdef";
const meta = () => ({ actor, operationId: randomUUID(), reason: "synthetic file test", traceId });

class FakeStorage implements StorageAdapter {
  readonly objects = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  readonly quarantined = new Set<string>();
  deleteFailures = 0;
  quarantineFailures = 0;
  uploadHandles: string[] = [];
  createUploadGrant = vi.fn((input: Parameters<StorageAdapter["createUploadGrant"]>[0]) => { this.uploadHandles.push(input.objectHandle); return Promise.resolve({ headers: { "content-type": input.declaredMediaType }, url: `https://upload.invalid/${randomUUID()}` }); });
  createDownloadGrant = vi.fn(() => Promise.resolve({ url: `https://download.invalid/${randomUUID()}` }));
  inspectObject = vi.fn(({ objectHandle }: { readonly objectHandle: string }): Promise<StorageObjectMetadata> => { const object = this.objects.get(objectHandle); return Promise.resolve(object ? { checksumSha256: "a".repeat(64), detectedMediaType: object.mediaType, exists: true, sizeBytes: object.bytes.byteLength } : { exists: false }); });
  readObject = vi.fn(({ maximumBytes, objectHandle }: Parameters<StorageAdapter["readObject"]>[0]) => { const bytes = this.objects.get(objectHandle)?.bytes; if (!bytes) return Promise.reject(new Error("missing")); if (bytes.byteLength > maximumBytes) return Promise.reject(new FileCenterError("file_center_policy_rejected")); return Promise.resolve(bytes); });
  quarantineObject = vi.fn(({ objectHandle }: { readonly objectHandle: string }) => { if (this.quarantineFailures > 0) { this.quarantineFailures -= 1; return Promise.reject(new Error("quarantine unavailable")); } this.quarantined.add(objectHandle); return Promise.resolve(); });
  deleteObject = vi.fn(({ objectHandle }: { readonly objectHandle: string }) => { if (this.deleteFailures > 0) { this.deleteFailures -= 1; return Promise.reject(new Error("storage unavailable")); } this.objects.delete(objectHandle); return Promise.resolve(); });
}

function setup(options: { readonly allowed?: boolean; readonly scan?: "clean" | "malicious" | "unavailable" | "unscannable" } = {}) {
  let current = new Date("2026-07-26T10:00:00.000Z"); let sequence = 1;
  const store = new MemoryFileCenterStore(); const storage = new FakeStorage();
  const authorizer = { authorize: vi.fn<FileAuthorizer["authorize"]>(() => Promise.resolve({ allowed: options.allowed ?? true, decisionId: randomUUID() })) };
  const audit = { record: vi.fn<FileAudit["record"]>(() => Promise.resolve()) };
  const scanner = { scan: vi.fn<MalwareScanner["scan"]>(() => options.scan === "unavailable" ? Promise.reject(new Error("scanner unavailable")) : Promise.resolve({ outcome: options.scan ?? "clean", scannerVersion: "synthetic.v1" })) };
  const id = () => `10000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`;
  const service = createFileCenterService(store, storage, scanner, authorizer, audit, { clock: () => current, downloadGrantTtlMs: 60_000, id, maximumScanBytes: 1024, maximumUploadBytes: 1024, uploadSessionTtlMs: 60_000 });
  return { audit, authorizer, scanner, service, setNow: (value: Date) => { current = value; }, storage, store };
}

const create = (service: ReturnType<typeof setup>["service"], operationId = randomUUID()) => service.createUploadSession({ ...meta(), declaredMediaType: "text/plain", declaredSizeBytes: 7, displayName: "synthetic.txt", operationId, ownerModule: "platform.synthetic" });
const upload = async (runtime: ReturnType<typeof setup>, created: Awaited<ReturnType<typeof create>>, bytes = new TextEncoder().encode("fixture")) => { const handle = runtime.storage.uploadHandles.at(-1); if (!handle) throw new Error("missing handle"); runtime.storage.objects.set(handle, { bytes, mediaType: "text/plain" }); return runtime.service.completeUpload({ ...meta(), sessionId: created.session.sessionId }); };

describe("File Center service", () => {
  it("creates an idempotent upload session without exposing the storage handle", async () => {
    const runtime = setup(); const operationId = randomUUID(); const first = await create(runtime.service, operationId); const replay = await create(runtime.service, operationId);
    expect(first.replayed).toBe(false); expect(replay.replayed).toBe(true); expect(replay.fileReference).toEqual(first.fileReference); expect(JSON.stringify(first)).not.toContain("objects/"); expect(first.uploadGrant.uploadUrl).toMatch(/^https:\/\/upload\.invalid\//u); expect(runtime.store.files.size).toBe(1);
  });

  it("creates immutable subsequent content versions and replays their assigned version", async () => {
    const runtime = setup(); const original = await create(runtime.service); const operationId = randomUUID();
    const command = { ...meta(), declaredMediaType: "text/plain", declaredSizeBytes: 7, fileId: original.fileReference.fileId, operationId };
    const [second, third] = await Promise.all([
      runtime.service.createContentVersionUpload(command),
      runtime.service.createContentVersionUpload({ ...meta(), declaredMediaType: "text/plain", declaredSizeBytes: 7, fileId: original.fileReference.fileId }),
    ]);
    const replay = await runtime.service.createContentVersionUpload(command);
    const originalState = await runtime.store.findContentVersion(original.fileReference.contentVersionId);
    const secondState = await runtime.store.findContentVersion(second.fileReference.contentVersionId);
    const thirdState = await runtime.store.findContentVersion(third.fileReference.contentVersionId);
    const replayState = await runtime.store.findContentVersion(replay.fileReference.contentVersionId);

    expect(originalState?.contentVersion).toMatchObject({ contentVersionId: original.fileReference.contentVersionId, status: "awaiting_upload", versionNumber: 1 });
    expect([secondState?.contentVersion.versionNumber, thirdState?.contentVersion.versionNumber].sort()).toEqual([2, 3]);
    expect(replay).toMatchObject({ fileReference: second.fileReference, replayed: true });
    expect(replayState?.contentVersion.versionNumber).toBe(secondState?.contentVersion.versionNumber);
  });

  it("uses trusted storage metadata and refuses size mismatch before scanning", async () => {
    const runtime = setup(); const created = await create(runtime.service); await expect(upload(runtime, created, new TextEncoder().encode("wrong"))).rejects.toMatchObject({ code: "file_center_policy_rejected" });
    expect((await runtime.store.findSession(created.session.sessionId))?.contentVersion.status).toBe("awaiting_upload");
  });

  it("makes a clean immutable version available, links it, and reauthorizes each download", async () => {
    const runtime = setup(); const created = await create(runtime.service); const completed = await upload(runtime, created); const scanned = await runtime.service.scanContentVersion({ ...meta(), contentVersionId: completed.contentVersion.contentVersionId }); expect(scanned.contentVersion.status).toBe("available");
    const resource = { resourceId: "synthetic:1", resourceType: "platform.resource" }; const linked = await runtime.service.linkResource({ ...meta(), fileReference: created.fileReference, linkId: randomUUID(), ownerModule: "platform.synthetic", relationType: "platform.attachment", resource });
    const before = runtime.authorizer.authorize.mock.calls.length; const grant = await runtime.service.authorizeDownload({ ...meta(), fileReference: created.fileReference, resource }); expect(grant.downloadUrl).toMatch(/^https:\/\/download\.invalid\//u); expect(runtime.authorizer.authorize.mock.calls.length - before).toBe(2); expect(linked.link.unlinkedAt).toBeUndefined();
  });

  it("quarantines malicious content and never signs a download", async () => {
    const runtime = setup({ scan: "malicious" }); const created = await create(runtime.service); const completed = await upload(runtime, created); const result = await runtime.service.scanContentVersion({ ...meta(), contentVersionId: completed.contentVersion.contentVersionId }); expect(result.contentVersion.status).toBe("quarantined"); expect(runtime.storage.quarantineObject).toHaveBeenCalledOnce();
    await expect(runtime.service.linkResource({ ...meta(), fileReference: created.fileReference, linkId: randomUUID(), ownerModule: "platform.synthetic", relationType: "platform.attachment", resource: { resourceId: "synthetic:1", resourceType: "platform.resource" } })).rejects.toMatchObject({ code: "file_center_not_ready" }); expect(runtime.storage.createDownloadGrant).not.toHaveBeenCalled();
  });

  it("persists quarantine intent and converges after storage isolation recovers", async () => {
    const runtime = setup({ scan: "malicious" }); const created = await create(runtime.service); const completed = await upload(runtime, created); runtime.storage.quarantineFailures = 1; const command = { ...meta(), contentVersionId: completed.contentVersion.contentVersionId };
    await expect(runtime.service.scanContentVersion(command)).rejects.toMatchObject({ code: "file_center_storage_unavailable", retryable: true }); expect((await runtime.store.findContentVersion(command.contentVersionId))?.contentVersion.status).toBe("quarantine_pending");
    await expect(runtime.service.scanContentVersion(command)).resolves.toMatchObject({ contentVersion: { status: "quarantined" }, replayed: true }); expect(runtime.scanner.scan).toHaveBeenCalledOnce();
  });

  it("keeps pending state when scanning is unavailable and supports recovery with the same operation", async () => {
    const runtime = setup({ scan: "unavailable" }); const created = await create(runtime.service); const completed = await upload(runtime, created); const command = { ...meta(), contentVersionId: completed.contentVersion.contentVersionId };
    await expect(runtime.service.scanContentVersion(command)).rejects.toMatchObject({ code: "file_center_scan_unavailable", retryable: true }); expect((await runtime.store.findContentVersion(command.contentVersionId))?.contentVersion.status).toBe("pending_scan");
    runtime.scanner.scan.mockResolvedValueOnce({ outcome: "clean", scannerVersion: "synthetic.v2" }); await expect(runtime.service.scanContentVersion(command)).resolves.toMatchObject({ contentVersion: { status: "available" } }); expect(runtime.scanner.scan).toHaveBeenCalledTimes(2);
  });

  it("rejects object growth at the bounded read port before invoking the scanner", async () => {
    const runtime = setup(); const created = await create(runtime.service); const completed = await upload(runtime, created); const handle = runtime.storage.uploadHandles.at(-1); if (!handle) throw new Error("missing handle"); runtime.storage.objects.set(handle, { bytes: new Uint8Array(2048), mediaType: "application/octet-stream" });
    await expect(runtime.service.scanContentVersion({ ...meta(), contentVersionId: completed.contentVersion.contentVersionId })).rejects.toMatchObject({ code: "file_center_policy_rejected" }); expect(runtime.scanner.scan).not.toHaveBeenCalled(); expect(runtime.storage.readObject).toHaveBeenCalledWith({ maximumBytes: 1024, objectHandle: handle });
  });

  it("replays completed upload and scan results without depending on expired sessions or moved objects", async () => {
    const runtime = setup(); const created = await create(runtime.service); const handle = runtime.storage.uploadHandles.at(-1); if (!handle) throw new Error("missing handle"); runtime.storage.objects.set(handle, { bytes: new TextEncoder().encode("fixture"), mediaType: "text/plain" });
    const completeCommand = { ...meta(), sessionId: created.session.sessionId }; const completed = await runtime.service.completeUpload(completeCommand); runtime.setNow(new Date(created.session.expiresAt)); runtime.storage.objects.delete(handle); const completeReplay = await runtime.service.completeUpload(completeCommand);
    expect(completeReplay).toEqual({ contentVersion: completed.contentVersion, replayed: true }); expect(runtime.storage.inspectObject).toHaveBeenCalledOnce();
    runtime.storage.objects.set(handle, { bytes: new TextEncoder().encode("fixture"), mediaType: "text/plain" }); const scanCommand = { ...meta(), contentVersionId: completed.contentVersion.contentVersionId }; const scanned = await runtime.service.scanContentVersion(scanCommand); runtime.storage.objects.delete(handle); const scanReplay = await runtime.service.scanContentVersion(scanCommand);
    expect(scanReplay).toEqual({ contentVersion: scanned.contentVersion, replayed: true }); expect(runtime.scanner.scan).toHaveBeenCalledOnce();
  });

  it("persists cleanup intent before deletion and converges after storage recovery", async () => {
    const runtime = setup(); const created = await create(runtime.service); const handle = runtime.storage.uploadHandles.at(-1); if (!handle) throw new Error("missing handle"); runtime.storage.objects.set(handle, { bytes: new Uint8Array([1]), mediaType: "application/octet-stream" }); runtime.storage.deleteFailures = 1; runtime.setNow(new Date("2026-07-26T10:02:00.000Z")); const command = { ...meta(), sessionId: created.session.sessionId };
    await expect(runtime.service.cleanupUploadSession(command)).rejects.toMatchObject({ code: "file_center_storage_unavailable", retryable: true }); expect((await runtime.store.findSession(created.session.sessionId))?.session.status).toBe("cleanup_pending");
    await expect(runtime.service.cleanupUploadSession(command)).resolves.toMatchObject({ cleaned: true, replayed: true }); expect((await runtime.store.findSession(created.session.sessionId))?.session.status).toBe("cleaned");
  });

  it("reconciles a missing object to an explicit unavailable state", async () => {
    const runtime = setup(); const created = await create(runtime.service); const completed = await upload(runtime, created); const handle = runtime.storage.uploadHandles.at(-1); if (!handle) throw new Error("missing handle"); runtime.storage.objects.delete(handle); const command = { ...meta(), contentVersionId: completed.contentVersion.contentVersionId }; const result = await runtime.service.reconcileContentVersion(command); expect(result.contentVersion.status).toBe("object_missing"); runtime.storage.objects.set(handle, { bytes: new TextEncoder().encode("fixture"), mediaType: "text/plain" }); const replay = await runtime.service.reconcileContentVersion(command); expect(replay).toEqual({ contentVersion: result.contentVersion, replayed: true }); expect(runtime.storage.inspectObject).toHaveBeenCalledTimes(2);
  });

  it("preserves quarantine and cleanup coordination states during reconciliation", async () => {
    const quarantine = setup({ scan: "malicious" }); const quarantineCreated = await create(quarantine.service); const completed = await upload(quarantine, quarantineCreated); const joined = await quarantine.store.findContentVersion(completed.contentVersion.contentVersionId); if (!joined) throw new Error("missing version"); await quarantine.store.recordScan({ contentVersionId: completed.contentVersion.contentVersionId, fingerprint: "a".repeat(64), operationId: randomUUID(), outcome: "malicious", scannedAt: "2026-07-26T10:00:00.000Z", scannerVersion: "synthetic.v1" }); quarantine.storage.objects.delete(joined.objectHandle); const reconciledQuarantine = await quarantine.service.reconcileContentVersion({ ...meta(), contentVersionId: completed.contentVersion.contentVersionId }); expect(reconciledQuarantine.contentVersion.status).toBe("quarantine_pending"); await expect(quarantine.service.scanContentVersion({ ...meta(), contentVersionId: completed.contentVersion.contentVersionId })).resolves.toMatchObject({ contentVersion: { status: "quarantined" } });
    const cleanup = setup(); const cleanupCreated = await create(cleanup.service); const cleanupJoined = await cleanup.store.findSession(cleanupCreated.session.sessionId); if (!cleanupJoined) throw new Error("missing session"); const pending = await cleanup.store.cleanupSession({ fingerprint: "b".repeat(64), operationId: randomUUID(), sessionId: cleanupCreated.session.sessionId }); await cleanup.storage.deleteObject({ objectHandle: pending.objectHandle }); const reconciledCleanup = await cleanup.service.reconcileContentVersion({ ...meta(), contentVersionId: cleanupCreated.fileReference.contentVersionId }); expect(reconciledCleanup.contentVersion.status).toBe("cleanup_pending"); await cleanup.store.completeCleanup(cleanupCreated.session.sessionId); expect((await cleanup.store.findSession(cleanupCreated.session.sessionId))?.contentVersion.status).toBe("deleted"); expect((await cleanup.store.findSession(cleanupCreated.session.sessionId))?.session.status).toBe("cleaned");
  });

  it("rechecks the upload deadline at the persistence boundary after storage inspection", async () => {
    const runtime = setup(); const created = await create(runtime.service); const handle = runtime.storage.uploadHandles.at(-1); if (!handle) throw new Error("missing handle"); runtime.storage.objects.set(handle, { bytes: new TextEncoder().encode("fixture"), mediaType: "text/plain" }); runtime.storage.inspectObject.mockImplementationOnce(() => { runtime.setNow(new Date(created.session.expiresAt)); return Promise.resolve({ checksumSha256: "a".repeat(64), detectedMediaType: "text/plain", exists: true, sizeBytes: 7 }); });
    await expect(runtime.service.completeUpload({ ...meta(), sessionId: created.session.sessionId })).rejects.toMatchObject({ code: "file_center_operation_conflict" }); const state = await runtime.store.findSession(created.session.sessionId); expect(state?.session.status).toBe("created"); expect(state?.contentVersion.status).toBe("awaiting_upload");
  });

  it("fails authorization before resource lookup", async () => {
    const runtime = setup({ allowed: false }); const lookup = vi.spyOn(runtime.store, "findSession"); await expect(runtime.service.completeUpload({ ...meta(), sessionId: randomUUID() })).rejects.toMatchObject({ code: "file_center_denied" }); expect(lookup).not.toHaveBeenCalled(); expect(runtime.audit.record).toHaveBeenCalledWith(expect.objectContaining({ result: "denied" }));
  });

  it("requires authorization for both the owning resource and the file owner before linking", async () => {
    const runtime = setup(); const created = await create(runtime.service); const completed = await upload(runtime, created); await runtime.service.scanContentVersion({ ...meta(), contentVersionId: completed.contentVersion.contentVersionId }); const storeCall = vi.spyOn(runtime.store, "linkResource");
    runtime.authorizer.authorize.mockResolvedValueOnce({ allowed: true, decisionId: randomUUID() }).mockResolvedValueOnce({ allowed: false, decisionId: randomUUID() });
    await expect(runtime.service.linkResource({ ...meta(), fileReference: created.fileReference, linkId: randomUUID(), ownerModule: "platform.other", relationType: "platform.attachment", resource: { resourceId: "synthetic:1", resourceType: "platform.resource" } })).rejects.toMatchObject({ code: "file_center_denied" }); expect(storeCall).not.toHaveBeenCalled(); expect(runtime.audit.record).toHaveBeenCalledWith(expect.objectContaining({ result: "denied" }));
  });

  it("audits a download denied by a missing current resource link", async () => {
    const runtime = setup(); const created = await create(runtime.service); const completed = await upload(runtime, created); await runtime.service.scanContentVersion({ ...meta(), contentVersionId: completed.contentVersion.contentVersionId }); runtime.audit.record.mockClear();
    await expect(runtime.service.authorizeDownload({ ...meta(), fileReference: created.fileReference, resource: { resourceId: "synthetic:missing", resourceType: "platform.resource" } })).rejects.toMatchObject({ code: "file_center_denied" }); expect(runtime.audit.record).toHaveBeenCalledWith(expect.objectContaining({ result: "denied" })); expect(runtime.storage.createDownloadGrant).not.toHaveBeenCalled();
  });

  it("rejects accessor-bearing dependency values without executing getters", async () => {
    let getterReads = 0; const badAuthorization = setup(); badAuthorization.authorizer.authorize.mockResolvedValueOnce(Object.defineProperty({ allowed: true }, "decisionId", { enumerable: true, get: () => { getterReads += 1; return randomUUID(); } }) as never); await expect(create(badAuthorization.service)).rejects.toMatchObject({ code: "file_center_storage_unavailable" }); expect(getterReads).toBe(0);
    const badStorage = setup(); const created = await create(badStorage.service); badStorage.storage.inspectObject.mockResolvedValueOnce(Object.defineProperty({ exists: true }, "sizeBytes", { enumerable: true, get: () => { getterReads += 1; return 7; } }) as never); await expect(badStorage.service.completeUpload({ ...meta(), sessionId: created.session.sessionId })).rejects.toMatchObject({ code: "file_center_storage_unavailable" }); expect(getterReads).toBe(0);
    const badScanner = setup(); const scanCreated = await create(badScanner.service); const completed = await upload(badScanner, scanCreated); badScanner.scanner.scan.mockResolvedValueOnce(Object.defineProperty({ outcome: "clean" }, "scannerVersion", { enumerable: true, get: () => { getterReads += 1; return "synthetic.v1"; } }) as never); await expect(badScanner.service.scanContentVersion({ ...meta(), contentVersionId: completed.contentVersion.contentVersionId })).rejects.toMatchObject({ code: "file_center_scan_unavailable" }); expect(getterReads).toBe(0);
    const badReconcile = setup(); const reconcileCreated = await create(badReconcile.service); badReconcile.storage.inspectObject.mockResolvedValueOnce(Object.defineProperty({}, "exists", { enumerable: true, get: () => { getterReads += 1; return false; } }) as never); await expect(badReconcile.service.reconcileContentVersion({ ...meta(), contentVersionId: reconcileCreated.fileReference.contentVersionId })).rejects.toMatchObject({ code: "file_center_storage_unavailable" }); expect(getterReads).toBe(0);
  });

  it("never extends or reissues an upload grant after the durable session is no longer active", async () => {
    const runtime = setup(); const operationId = randomUUID(); const created = await create(runtime.service, operationId); expect(created.uploadGrant.expiresAt).toBe(created.session.expiresAt); runtime.setNow(new Date(created.session.expiresAt));
    await expect(create(runtime.service, operationId)).rejects.toMatchObject({ code: "file_center_operation_conflict" }); expect(runtime.storage.createUploadGrant).toHaveBeenCalledOnce();
  });
});
