import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { ContentVersion, DownloadGrant, FileReference, ResourceLink, UploadGrant, UploadSession } from "./index.js";

const uuid = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const timestamp = "2026-07-26T10:00:00.000Z";

async function validator(name: string) {
  const schema = JSON.parse(await readFile(new URL(`../../../../contracts/files/${name}.v1.schema.json`, import.meta.url), "utf8")) as object;
  return new Ajv2020({ strict: true, validateFormats: false }).compile(schema);
}

describe("File Center contract alignment", () => {
  it("accepts every public runtime value and rejects storage implementation details", async () => {
    const fileReference = { contentVersionId: uuid("2"), displayName: "synthetic.txt", fileId: uuid("1"), mediaType: "text/plain", sizeBytes: 7, version: 1 } satisfies FileReference;
    const contentVersion = { actualSizeBytes: 7, checksumSha256: "a".repeat(64), completedAt: timestamp, contentVersionId: fileReference.contentVersionId, createdAt: timestamp, declaredMediaType: "text/plain", declaredSizeBytes: 7, detectedMediaType: "text/plain", fileId: fileReference.fileId, scannedAt: timestamp, status: "available", version: 1, versionNumber: 2 } satisfies ContentVersion;
    const uploadSession = { contentVersionId: fileReference.contentVersionId, createdAt: timestamp, expiresAt: timestamp, fileId: fileReference.fileId, sessionId: uuid("3"), status: "created", version: 1 } satisfies UploadSession;
    const resourceLink = { contentVersionId: fileReference.contentVersionId, fileId: fileReference.fileId, linkedAt: timestamp, linkId: uuid("4"), ownerModule: "platform.synthetic", relationType: "platform.attachment", resource: { resourceId: "synthetic:1", resourceType: "platform.resource" }, version: 1 } satisfies ResourceLink;
    const uploadGrant = { expiresAt: timestamp, headers: { "content-type": "text/plain" }, method: "PUT", uploadUrl: "https://upload.invalid/grant", version: 1 } satisfies UploadGrant;
    const downloadGrant = { downloadUrl: "https://download.invalid/grant", expiresAt: timestamp, fileReference, version: 1 } satisfies DownloadGrant;
    const values = new Map<string, unknown>([["file-reference", fileReference], ["content-version", contentVersion], ["upload-session", uploadSession], ["resource-link", resourceLink]]);
    for (const [name, value] of values) { const validate = await validator(name); expect(validate(value), `${name}: ${JSON.stringify(validate.errors)}`).toBe(true); expect(validate({ ...value as object, objectHandle: "objects/private" })).toBe(false); }
    const validateGrant = await validator("transfer-grant"); expect(validateGrant(uploadGrant), JSON.stringify(validateGrant.errors)).toBe(true); expect(validateGrant(downloadGrant), JSON.stringify(validateGrant.errors)).toBe(true); expect(validateGrant({ ...downloadGrant, bucket: "private" })).toBe(false);
  });
});
