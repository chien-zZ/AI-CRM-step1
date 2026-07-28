import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalFileStorageAdapter } from "./index.js";
import { describeStorageAdapterConformance } from "./storage-adapter.conformance.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))));
const handle = "objects/10000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000002";
const missingHandle = "objects/10000000-0000-4000-8000-000000000003/10000000-0000-4000-8000-000000000004";

describeStorageAdapterConformance({
  name: "LocalFileStorageAdapter",
  async createFixture() {
    const root = await mkdtemp(join(tmpdir(), "ai-crm-file-center-contract-"));
    const observations: Array<Parameters<ConstructorParameters<typeof LocalFileStorageAdapter>[0]["grantUrl"]>[0]> = [];
    const adapter = new LocalFileStorageAdapter({
      grantUrl: (input) => { observations.push(input); return `http://local.invalid/${input.kind}`; },
      rootDirectory: root,
    });
    return {
      adapter,
      dispose: () => rm(root, { force: true, recursive: true }),
      invalidObjectHandle: "../outside",
      missingObjectHandle: missingHandle,
      objectHandle: handle,
      observations,
      seedObject: (input) => adapter.writeObjectForDevelopment({ ...input, objectHandle: handle }),
    };
  },
});

describe("LocalFileStorageAdapter", () => {
  it("stores immutable content below the controlled root and supports quarantine", async () => {
    const root = await mkdtemp(join(tmpdir(), "ai-crm-file-center-")); directories.push(root); const adapter = new LocalFileStorageAdapter({ grantUrl: ({ kind }) => `http://local.invalid/${kind}`, rootDirectory: root }); const bytes = new TextEncoder().encode("synthetic");
    await adapter.writeObjectForDevelopment({ bytes, detectedMediaType: "text/plain", objectHandle: handle }); await expect(adapter.inspectObject({ objectHandle: handle })).resolves.toMatchObject({ exists: true, sizeBytes: bytes.byteLength }); await expect(adapter.writeObjectForDevelopment({ bytes, detectedMediaType: "text/plain", objectHandle: handle })).rejects.toMatchObject({ code: "file_center_operation_conflict" }); await adapter.quarantineObject({ objectHandle: handle }); await expect(adapter.inspectObject({ objectHandle: handle })).resolves.toEqual({ exists: false });
    expect(await readFile(join(root, "quarantine", createHash("sha256").update(handle).digest("hex")))).toEqual(Buffer.from(bytes));
  });
  it("enforces the scan byte limit at the storage read boundary", async () => { const root = await mkdtemp(join(tmpdir(), "ai-crm-file-center-")); directories.push(root); const adapter = new LocalFileStorageAdapter({ grantUrl: () => "http://local.invalid", rootDirectory: root }); const handle = "objects/10000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000002"; await adapter.writeObjectForDevelopment({ bytes: new Uint8Array([1]), detectedMediaType: "application/octet-stream", objectHandle: handle }); await writeFile(join(root, ...handle.split("/")), new Uint8Array(2048)); await expect(adapter.readObject({ maximumBytes: 16, objectHandle: handle })).rejects.toMatchObject({ code: "file_center_policy_rejected" }); });
  it("fails closed when the quarantine directory is a link outside the controlled root", async () => { const root = await mkdtemp(join(tmpdir(), "ai-crm-file-center-")); const outside = await mkdtemp(join(tmpdir(), "ai-crm-file-outside-")); directories.push(root, outside); const adapter = new LocalFileStorageAdapter({ grantUrl: () => "http://local.invalid", rootDirectory: root }); const handle = "objects/10000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000002"; await adapter.writeObjectForDevelopment({ bytes: new Uint8Array([1]), detectedMediaType: "application/octet-stream", objectHandle: handle }); await symlink(outside, join(root, "quarantine"), process.platform === "win32" ? "junction" : "dir"); await expect(adapter.quarantineObject({ objectHandle: handle })).rejects.toMatchObject({ code: "file_center_storage_unavailable" }); expect(await readdir(outside)).toEqual([]); });
  it("repairs a quarantine after the object move succeeded but metadata move did not", async () => { const root = await mkdtemp(join(tmpdir(), "ai-crm-file-center-")); directories.push(root); const adapter = new LocalFileStorageAdapter({ grantUrl: () => "http://local.invalid", rootDirectory: root }); const handle = "objects/10000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000002"; await adapter.writeObjectForDevelopment({ bytes: new Uint8Array([1]), detectedMediaType: "application/octet-stream", objectHandle: handle }); const source = join(root, ...handle.split("/")); const target = join(root, "quarantine", createHash("sha256").update(handle).digest("hex")); await mkdir(join(root, "quarantine")); await rename(source, target); await adapter.quarantineObject({ objectHandle: handle }); await expect(readFile(`${target}.metadata.json`, "utf8")).resolves.toContain("application/octet-stream"); await expect(readFile(`${source}.metadata.json`, "utf8")).rejects.toMatchObject({ code: "ENOENT" }); });
});
