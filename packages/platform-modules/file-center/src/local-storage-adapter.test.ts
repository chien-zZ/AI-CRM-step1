import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalFileStorageAdapter } from "./index.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))));
describe("LocalFileStorageAdapter", () => {
  it("stores immutable content below the controlled root and supports quarantine", async () => {
    const root = await mkdtemp(join(tmpdir(), "ai-crm-file-center-")); directories.push(root); const adapter = new LocalFileStorageAdapter({ grantUrl: ({ kind }) => `http://local.invalid/${kind}`, rootDirectory: root }); const handle = "objects/10000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000002"; const bytes = new TextEncoder().encode("synthetic");
    await adapter.writeObjectForDevelopment({ bytes, detectedMediaType: "text/plain", objectHandle: handle }); await expect(adapter.inspectObject({ objectHandle: handle })).resolves.toMatchObject({ exists: true, sizeBytes: bytes.byteLength }); await expect(adapter.writeObjectForDevelopment({ bytes, detectedMediaType: "text/plain", objectHandle: handle })).rejects.toMatchObject({ code: "file_center_operation_conflict" }); await adapter.quarantineObject({ objectHandle: handle }); await expect(adapter.inspectObject({ objectHandle: handle })).resolves.toEqual({ exists: false });
    expect(await readFile(join(root, "quarantine", createHash("sha256").update(handle).digest("hex")))).toEqual(Buffer.from(bytes));
  });
  it("rejects client-controlled paths", async () => { const root = await mkdtemp(join(tmpdir(), "ai-crm-file-center-")); directories.push(root); const adapter = new LocalFileStorageAdapter({ grantUrl: () => "http://local.invalid", rootDirectory: root }); await expect(adapter.inspectObject({ objectHandle: "../outside" })).rejects.toMatchObject({ code: "file_center_invalid_input" }); });
});
