import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadFileProviderConfiguration } from "./file-provider-config.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))); });

async function fixture(secretId = "synthetic-secret-id", secretKey = "synthetic-secret-key"): Promise<NodeJS.ProcessEnv> {
  const directory = await mkdtemp(join(tmpdir(), "ai-crm-file-provider-"));
  directories.push(directory);
  const idFile = join(directory, "cos-id");
  const keyFile = join(directory, "cos-key");
  await writeFile(idFile, secretId, { mode: 0o600 });
  await writeFile(keyFile, secretKey, { mode: 0o600 });
  await chmod(idFile, 0o600); await chmod(keyFile, 0o600);
  return {
    AI_CRM_CLAMAV_HOST: "clamav",
    AI_CRM_CLAMAV_PORT: "3310",
    AI_CRM_CLAMAV_TIMEOUT_MS: "10000",
    AI_CRM_COS_BUCKET: "synthetic-test-1250000000",
    AI_CRM_COS_REGION: "ap-test",
    AI_CRM_COS_SECRET_ID_FILE: idFile,
    AI_CRM_COS_SECRET_KEY_FILE: keyFile,
    AI_CRM_COS_TIMEOUT_MS: "10000",
  };
}

describe("loadFileProviderConfiguration", () => {
  it("loads non-secret routing and separate file-backed COS credentials", async () => {
    await expect(loadFileProviderConfiguration({ env: await fixture() })).resolves.toEqual({
      clamav: { host: "clamav", port: 3310, timeoutMs: 10_000 },
      cos: { bucket: "synthetic-test-1250000000", region: "ap-test", secretId: "synthetic-secret-id", secretKey: "synthetic-secret-key", timeoutMs: 10_000 },
    });
  });

  it("fails closed when a credential file is absent", async () => {
    const env = await fixture();
    env.AI_CRM_COS_SECRET_KEY_FILE = join(tmpdir(), "definitely-absent-ai-crm-cos-key");
    await expect(loadFileProviderConfiguration({ env })).rejects.toMatchObject({ code: "secret_unreadable", variable: "AI_CRM_COS_SECRET_KEY_FILE" });
  });

  it("rejects reused credentials and malformed Bucket identifiers", async () => {
    await expect(loadFileProviderConfiguration({ env: await fixture("same-invalid-fixture", "same-invalid-fixture") })).rejects.toThrow("worker_cos_credentials_not_separated");
    const env = await fixture(); env.AI_CRM_COS_BUCKET = "not-reviewed";
    await expect(loadFileProviderConfiguration({ env })).rejects.toMatchObject({ code: "invalid_value", variable: "AI_CRM_COS_BUCKET" });
  });
});
