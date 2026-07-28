import { describe, expect, it } from "vitest";
import type { StorageAdapter } from "./types.js";

type GrantObservation = {
  readonly declaredMediaType: string;
  readonly declaredSizeBytes: number;
  readonly expiresAt: string;
  readonly kind: "upload";
  readonly objectHandle: string;
} | {
  readonly contentDisposition: string;
  readonly expiresAt: string;
  readonly kind: "download";
  readonly objectHandle: string;
};

export interface StorageAdapterConformanceFixture {
  readonly adapter: StorageAdapter;
  readonly invalidObjectHandle: string;
  readonly missingObjectHandle: string;
  readonly objectHandle: string;
  readonly observations: readonly GrantObservation[];
  readonly dispose: () => Promise<void>;
  readonly seedObject: (input: { readonly bytes: Uint8Array; readonly detectedMediaType: string }) => Promise<void>;
}

export interface StorageAdapterConformanceOptions {
  readonly createFixture: () => Promise<StorageAdapterConformanceFixture>;
  readonly name: string;
}

const uploadExpiry = "2026-07-28T10:01:00.000Z";
const downloadExpiry = "2026-07-28T10:02:00.000Z";

async function withFixture(
  createFixture: StorageAdapterConformanceOptions["createFixture"],
  test: (fixture: StorageAdapterConformanceFixture) => Promise<void>,
): Promise<void> {
  const fixture = await createFixture();
  try { await test(fixture); } finally { await fixture.dispose(); }
}

function expectPlainObjectShape(value: unknown, requiredKeys: readonly string[], optionalKeys: readonly string[] = []): asserts value is Record<string, unknown> {
  expect(typeof value).toBe("object");
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  const keys = Object.keys(value as object);
  expect(requiredKeys.every((key) => keys.includes(key))).toBe(true);
  expect(keys.every((key) => requiredKeys.includes(key) || optionalKeys.includes(key))).toBe(true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    expect(Object.hasOwn(descriptor, "get")).toBe(false);
    expect(Object.hasOwn(descriptor, "set")).toBe(false);
  }
}

function expectGrantUrl(value: unknown): void {
  expect(typeof value).toBe("string");
  const parsed = new URL(value as string);
  expect(["http:", "https:"]).toContain(parsed.protocol);
  expect(parsed.username).toBe("");
  expect(parsed.password).toBe("");
}

export function describeStorageAdapterConformance(options: StorageAdapterConformanceOptions): void {
  const createFixture = () => options.createFixture();
  describe(`${options.name} StorageAdapter conformance`, () => {
    it("passes grant inputs and returns only the public grant shape", async () => withFixture(createFixture, async (fixture) => {
      const upload = await fixture.adapter.createUploadGrant({
        declaredMediaType: "application/octet-stream",
        declaredSizeBytes: 9,
        expiresAt: uploadExpiry,
        objectHandle: fixture.objectHandle,
      });
      expectPlainObjectShape(upload, ["url"], ["headers"]);
      expectGrantUrl(upload.url);
      if (upload.headers !== undefined) {
        expectPlainObjectShape(upload.headers, Object.keys(upload.headers));
        expect(Object.entries(upload.headers).every(([key, value]) => key.length > 0 && key.length <= 128 && typeof value === "string" && value.length <= 1024)).toBe(true);
      }

      await fixture.seedObject({ bytes: new TextEncoder().encode("synthetic"), detectedMediaType: "text/plain" });
      const download = await fixture.adapter.createDownloadGrant({ contentDisposition: "attachment; filename=synthetic.txt", expiresAt: downloadExpiry, objectHandle: fixture.objectHandle });
      expectPlainObjectShape(download, ["url"]);
      expectGrantUrl(download.url);
      expect(fixture.observations).toEqual([
        { declaredMediaType: "application/octet-stream", declaredSizeBytes: 9, expiresAt: uploadExpiry, kind: "upload", objectHandle: fixture.objectHandle },
        { contentDisposition: "attachment; filename=synthetic.txt", expiresAt: downloadExpiry, kind: "download", objectHandle: fixture.objectHandle },
      ]);
    }));

    it("reports trusted metadata and enforces the read byte ceiling", async () => withFixture(createFixture, async (fixture) => {
      const bytes = new TextEncoder().encode("synthetic");
      await fixture.seedObject({ bytes, detectedMediaType: "text/plain" });
      await expect(fixture.adapter.inspectObject({ objectHandle: fixture.objectHandle })).resolves.toMatchObject({ detectedMediaType: "text/plain", exists: true, sizeBytes: bytes.byteLength });
      const read = await fixture.adapter.readObject({ maximumBytes: bytes.byteLength, objectHandle: fixture.objectHandle });
      expect([...read]).toEqual([...bytes]);
      await expect(fixture.adapter.readObject({ maximumBytes: bytes.byteLength - 1, objectHandle: fixture.objectHandle })).rejects.toMatchObject({ code: "file_center_policy_rejected" });
      await expect(fixture.adapter.readObject({ maximumBytes: 0, objectHandle: fixture.objectHandle })).rejects.toMatchObject({ code: "file_center_invalid_input" });
    }));

    it("converges repeated quarantine and delete operations", async () => withFixture(createFixture, async (fixture) => {
      await fixture.seedObject({ bytes: new TextEncoder().encode("synthetic"), detectedMediaType: "text/plain" });
      await fixture.adapter.quarantineObject({ objectHandle: fixture.objectHandle });
      await fixture.adapter.quarantineObject({ objectHandle: fixture.objectHandle });
      await expect(fixture.adapter.inspectObject({ objectHandle: fixture.objectHandle })).resolves.toEqual({ exists: false });
      await fixture.adapter.deleteObject({ objectHandle: fixture.objectHandle });
      await fixture.adapter.deleteObject({ objectHandle: fixture.objectHandle });
      await expect(fixture.adapter.inspectObject({ objectHandle: fixture.objectHandle })).resolves.toEqual({ exists: false });
    }));

    it("keeps deletion idempotent when the source object never existed", async () => withFixture(createFixture, async (fixture) => {
      await fixture.adapter.deleteObject({ objectHandle: fixture.missingObjectHandle });
      await fixture.adapter.deleteObject({ objectHandle: fixture.missingObjectHandle });
      await expect(fixture.adapter.inspectObject({ objectHandle: fixture.missingObjectHandle })).resolves.toEqual({ exists: false });
    }));

    it("classifies invalid handles and missing-object failures", async () => withFixture(createFixture, async (fixture) => {
      await expect(fixture.adapter.createUploadGrant({ declaredMediaType: "text/plain", declaredSizeBytes: 1, expiresAt: uploadExpiry, objectHandle: fixture.invalidObjectHandle })).rejects.toMatchObject({ code: "file_center_invalid_input", retryable: false });
      await expect(fixture.adapter.inspectObject({ objectHandle: fixture.invalidObjectHandle })).rejects.toMatchObject({ code: "file_center_invalid_input", retryable: false });
      await expect(fixture.adapter.readObject({ maximumBytes: 1, objectHandle: fixture.missingObjectHandle })).rejects.toMatchObject({ code: "file_center_not_found", retryable: false });
      await expect(fixture.adapter.createDownloadGrant({ contentDisposition: "attachment", expiresAt: downloadExpiry, objectHandle: fixture.missingObjectHandle })).rejects.toMatchObject({ code: "file_center_not_found", retryable: false });
      await expect(fixture.adapter.quarantineObject({ objectHandle: fixture.missingObjectHandle })).rejects.toMatchObject({ code: "file_center_storage_unavailable", retryable: true });
    }));
  });
}
