import { configuration, loadConfiguration, type LoadConfigurationOptions } from "@ai-crm/config";

const schema = {
  clamavHost: configuration.string("AI_CRM_CLAMAV_HOST", { maxLength: 253, pattern: /^(?!.*\s)[a-zA-Z0-9.-]+$/u }),
  clamavPort: configuration.integer("AI_CRM_CLAMAV_PORT", { maximum: 65_535, minimum: 1 }),
  clamavTimeoutMs: configuration.integer("AI_CRM_CLAMAV_TIMEOUT_MS", { maximum: 120_000, minimum: 100 }),
  cosBucket: configuration.string("AI_CRM_COS_BUCKET", { maxLength: 255, pattern: /^[a-z0-9][a-z0-9.-]*-[1-9][0-9]{4,}$/u }),
  cosRegion: configuration.string("AI_CRM_COS_REGION", { maxLength: 64, pattern: /^[a-z][a-z0-9-]+$/u }),
  cosSecretId: configuration.secretFile("AI_CRM_COS_SECRET_ID_FILE"),
  cosSecretKey: configuration.secretFile("AI_CRM_COS_SECRET_KEY_FILE"),
  cosTimeoutMs: configuration.integer("AI_CRM_COS_TIMEOUT_MS", { maximum: 120_000, minimum: 100 }),
} as const;

export interface FileProviderConfiguration {
  readonly clamav: Readonly<{ readonly host: string; readonly port: number; readonly timeoutMs: number }>;
  readonly cos: Readonly<{
    readonly bucket: string;
    readonly region: string;
    readonly secretId: string;
    readonly secretKey: string;
    readonly timeoutMs: number;
  }>;
}

export async function loadFileProviderConfiguration(
  options: LoadConfigurationOptions = {},
): Promise<Readonly<FileProviderConfiguration>> {
  const value = await loadConfiguration(schema, options);
  if (value.cosSecretId === value.cosSecretKey) throw new Error("worker_cos_credentials_not_separated");
  return Object.freeze({
    clamav: Object.freeze({ host: value.clamavHost, port: value.clamavPort, timeoutMs: value.clamavTimeoutMs }),
    cos: Object.freeze({
      bucket: value.cosBucket,
      region: value.cosRegion,
      secretId: value.cosSecretId,
      secretKey: value.cosSecretKey,
      timeoutMs: value.cosTimeoutMs,
    }),
  });
}
