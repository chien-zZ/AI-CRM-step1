import { describe, expect, it, vi } from "vitest";
import type COS from "cos-nodejs-sdk-v5";
import { TencentCosStorageAdapter, type CosClient } from "./cos-storage-adapter.js";

const objectHandle = "objects/10000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000002";

function client(overrides: Partial<CosClient> = {}): CosClient {
  return {
    deleteObject: vi.fn(() => Promise.resolve({ statusCode: 204 })) as CosClient["deleteObject"],
    getObject: vi.fn(() => Promise.resolve({ Body: Buffer.from("synthetic"), ETag: "opaque", statusCode: 206 })) as CosClient["getObject"],
    getObjectUrl: vi.fn(() => "https://test-bucket-1250000000.cos.ap-test.myqcloud.com/signed") as CosClient["getObjectUrl"],
    headBucket: vi.fn(() => Promise.resolve({ statusCode: 200 })) as CosClient["headBucket"],
    headObject: vi.fn(() => Promise.resolve({ "content-length": "9", "content-type": "text/plain", ETag: "opaque", statusCode: 200 })) as CosClient["headObject"],
    putObjectCopy: vi.fn(() => Promise.resolve({ ETag: "opaque", statusCode: 200 })) as unknown as CosClient["putObjectCopy"],
    ...overrides,
  };
}

function adapter(cos = client()): TencentCosStorageAdapter {
  return new TencentCosStorageAdapter({ bucket: "test-bucket-1250000000", client: cos, clock: () => Date.parse("2026-07-29T00:00:00.000Z"), region: "ap-test" });
}

function providerError(statusCode: number): Error & { readonly providerPayload: string; readonly statusCode: number } {
  return Object.assign(new Error("synthetic_provider_failure"), { providerPayload: "must-not-escape", statusCode });
}

describe("TencentCosStorageAdapter", () => {
  it("reports reviewed Bucket access without leaking a provider failure", async () => {
    await expect(adapter().checkHealth()).resolves.toBe(true);
    const unavailable = adapter(client({ headBucket: vi.fn(() => Promise.reject(providerError(403))) as CosClient["headBucket"] }));
    await expect(unavailable.checkHealth()).resolves.toBe(false);
  });

  it("creates HTTPS signed grants without exposing provider configuration", async () => {
    const cos = client();
    const storage = adapter(cos);
    const grant = await storage.createUploadGrant({ declaredMediaType: "text/plain", declaredSizeBytes: 9, expiresAt: "2026-07-29T00:01:00.000Z", objectHandle });
    expect(grant.headers).toEqual({ "content-type": "text/plain" });
    expect(grant.url).toMatch(/^https:/u);
    expect(cos.getObjectUrl).toHaveBeenCalledWith(expect.objectContaining({ Expires: 60, Method: "PUT", Protocol: "https:", Sign: true }));
  });

  it("maps absent and transient provider failures without returning payloads", async () => {
    const missing = adapter(client({ headObject: vi.fn(() => Promise.reject(providerError(404))) as CosClient["headObject"] }));
    await expect(missing.inspectObject({ objectHandle })).resolves.toEqual({ exists: false });
    const unavailable = adapter(client({ headObject: vi.fn(() => Promise.reject(providerError(503))) as CosClient["headObject"] }));
    await expect(unavailable.inspectObject({ objectHandle })).rejects.toMatchObject({ code: "file_center_storage_unavailable", retryable: true });
  });

  it("binds the safe response content disposition into a download grant", async () => {
    const cos = client();
    await adapter(cos).createDownloadGrant({ contentDisposition: "attachment; filename=synthetic.txt", expiresAt: "2026-07-29T00:01:00.000Z", objectHandle });
    expect(cos.getObjectUrl).toHaveBeenCalledWith(expect.objectContaining({ Method: "GET", Query: { "response-content-disposition": "attachment; filename=synthetic.txt" } }));
  });

  it("uses a bounded range and rejects an oversized provider response", async () => {
    const cos = client({ getObject: vi.fn(() => Promise.resolve({ Body: Buffer.alloc(11), ETag: "opaque" } as COS.GetObjectResult)) as CosClient["getObject"] });
    await expect(adapter(cos).readObject({ maximumBytes: 10, objectHandle })).rejects.toMatchObject({ code: "file_center_policy_rejected" });
    expect(cos.getObject).toHaveBeenCalledWith(expect.objectContaining({ Range: "bytes=0-10" }));
  });

  it("fails closed on invalid handles before a provider call", async () => {
    const cos = client();
    await expect(adapter(cos).inspectObject({ objectHandle: "../escape" })).rejects.toMatchObject({ code: "file_center_invalid_input", retryable: false });
    expect(cos.headObject).not.toHaveBeenCalled();
  });
});
