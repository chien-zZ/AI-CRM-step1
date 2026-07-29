import { createHash, randomUUID } from "node:crypto";
import { describe } from "vitest";
import COS from "cos-nodejs-sdk-v5";
import { describeStorageAdapterConformance } from "@ai-crm/platform-file-center/testing/storage-adapter-conformance";
import { loadFileProviderConfiguration } from "./file-provider-config.js";
import { createTencentCosStorageAdapter } from "./cos-storage-adapter.js";

const enabled = process.env.AI_CRM_COS_CONFORMANCE_ENABLED === "true";
const integration = enabled ? describe : describe.skip;
type Observation =
  | (Parameters<ReturnType<typeof createTencentCosStorageAdapter>["createUploadGrant"]>[0] & { readonly kind: "upload" })
  | (Parameters<ReturnType<typeof createTencentCosStorageAdapter>["createDownloadGrant"]>[0] & { readonly kind: "download" });

integration("reviewed Tencent COS test Bucket", () => {
  describeStorageAdapterConformance({
    name: "TencentCosStorageAdapter (real test Bucket)",
    async createFixture() {
      const configuration = await loadFileProviderConfiguration();
      const sdk = new COS({ KeepAlive: true, SecretId: configuration.cos.secretId, SecretKey: configuration.cos.secretKey, StrictSsl: true, Timeout: configuration.cos.timeoutMs });
      const adapter = createTencentCosStorageAdapter(configuration.cos);
      const objectHandle = `objects/${randomUUID()}/${randomUUID()}`;
      const missingObjectHandle = `objects/${randomUUID()}/${randomUUID()}`;
      const observations: Observation[] = [];
      const observed = {
        createUploadGrant: async (input: Parameters<typeof adapter.createUploadGrant>[0]) => { observations.push({ ...input, kind: "upload" }); return adapter.createUploadGrant(input); },
        createDownloadGrant: async (input: Parameters<typeof adapter.createDownloadGrant>[0]) => { observations.push({ ...input, kind: "download" }); return adapter.createDownloadGrant(input); },
        deleteObject: (input: Parameters<typeof adapter.deleteObject>[0]) => adapter.deleteObject(input),
        inspectObject: (input: Parameters<typeof adapter.inspectObject>[0]) => adapter.inspectObject(input),
        quarantineObject: (input: Parameters<typeof adapter.quarantineObject>[0]) => adapter.quarantineObject(input),
        readObject: (input: Parameters<typeof adapter.readObject>[0]) => adapter.readObject(input),
      };
      return {
        adapter: observed,
        invalidObjectHandle: "../invalid",
        missingObjectHandle,
        objectHandle,
        observations,
        async seedObject({ bytes, detectedMediaType }: { readonly bytes: Uint8Array; readonly detectedMediaType: string }) {
          await sdk.putObject({ Body: Buffer.from(bytes), Bucket: configuration.cos.bucket, ContentLength: bytes.byteLength, ContentType: detectedMediaType, Key: objectHandle, Region: configuration.cos.region });
        },
        async dispose() {
          const quarantineKey = `quarantine/${createHash("sha256").update(objectHandle).digest("hex")}`;
          await Promise.allSettled([objectHandle, quarantineKey, missingObjectHandle].map(async (Key) => sdk.deleteObject({ Bucket: configuration.cos.bucket, Key, Region: configuration.cos.region })));
        },
      };
    },
  });
});
