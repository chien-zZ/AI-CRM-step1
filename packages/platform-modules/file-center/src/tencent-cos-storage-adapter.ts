import { createHash } from "node:crypto";
import COS from "cos-nodejs-sdk-v5";
import { FileCenterError } from "./errors.js";
import type { StorageAdapter, StorageObjectMetadata } from "./types.js";

const HANDLE = /^objects\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type CosClient = Pick<COS, "deleteObject" | "getObject" | "getObjectUrl" | "headBucket" | "headObject" | "putObjectCopy">;
export interface CosStorageAdapterOptions {
  readonly bucket: string;
  readonly client: CosClient;
  readonly clock?: () => number;
  readonly region: string;
}

function handle(value: string): string {
  if (!HANDLE.test(value)) throw new FileCenterError("file_center_invalid_input");
  return value;
}

function status(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as { readonly statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : undefined;
}

function providerFailure(error: unknown, missingAsNotFound = false): FileCenterError {
  const code = status(error);
  if (code === 404 && missingAsNotFound) return new FileCenterError("file_center_not_found", { cause: error });
  const retryable = code === undefined || code === 408 || code === 429 || code >= 500;
  return new FileCenterError("file_center_storage_unavailable", { cause: error, retryable });
}

function sizeFrom(headers: object): number | undefined {
  const raw = (headers as Record<string, unknown>)["content-length"];
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function mediaTypeFrom(headers: object): string | undefined {
  const raw = (headers as Record<string, unknown>)["content-type"];
  return typeof raw === "string" && raw.length <= 255 ? raw : undefined;
}

export class TencentCosStorageAdapter implements StorageAdapter {
  readonly #bucket: string;
  readonly #client: CosClient;
  readonly #clock: () => number;
  readonly #region: string;

  constructor(options: CosStorageAdapterOptions) {
    this.#bucket = options.bucket;
    this.#client = options.client;
    this.#clock = options.clock ?? Date.now;
    this.#region = options.region;
  }

  async checkHealth(): Promise<boolean> {
    try { await this.#client.headBucket({ Bucket: this.#bucket, Region: this.#region }); return true; }
    catch { return false; }
  }

  #grant(key: string, expiresAt: string, method: "GET" | "PUT", contentDisposition?: string): string {
    const expires = Math.ceil((Date.parse(expiresAt) - this.#clock()) / 1_000);
    if (!Number.isSafeInteger(expires) || expires < 1 || expires > 3_600) throw new FileCenterError("file_center_invalid_input");
    try {
      return this.#client.getObjectUrl({
        Bucket: this.#bucket,
        Expires: expires,
        Key: key,
        Method: method,
        Protocol: "https:",
        ...(contentDisposition === undefined ? {} : { Query: { "response-content-disposition": contentDisposition } }),
        Region: this.#region,
        Sign: true,
      });
    } catch (error) { throw providerFailure(error); }
  }

  createUploadGrant(input: Parameters<StorageAdapter["createUploadGrant"]>[0]): Promise<{ readonly headers: Readonly<Record<string, string>>; readonly url: string }> {
    const key = handle(input.objectHandle);
    if (!Number.isSafeInteger(input.declaredSizeBytes) || input.declaredSizeBytes < 1) return Promise.reject(new FileCenterError("file_center_invalid_input"));
    return Promise.resolve({ headers: Object.freeze({ "content-type": input.declaredMediaType }), url: this.#grant(key, input.expiresAt, "PUT") });
  }

  async createDownloadGrant(input: Parameters<StorageAdapter["createDownloadGrant"]>[0]): Promise<{ readonly url: string }> {
    const key = handle(input.objectHandle);
    const metadata = await this.inspectObject({ objectHandle: key });
    if (!metadata.exists) throw new FileCenterError("file_center_not_found");
    return { url: this.#grant(key, input.expiresAt, "GET", input.contentDisposition) };
  }

  async inspectObject(input: Parameters<StorageAdapter["inspectObject"]>[0]): Promise<StorageObjectMetadata> {
    const key = handle(input.objectHandle);
    try {
      const result = await this.#client.headObject({ Bucket: this.#bucket, Key: key, Region: this.#region });
      const detectedMediaType = mediaTypeFrom(result);
      const sizeBytes = sizeFrom(result);
      return {
        exists: true,
        ...(detectedMediaType === undefined ? {} : { detectedMediaType }),
        ...(sizeBytes === undefined ? {} : { sizeBytes }),
      };
    } catch (error) {
      if (status(error) === 404) return { exists: false };
      throw providerFailure(error);
    }
  }

  async readObject(input: Parameters<StorageAdapter["readObject"]>[0]): Promise<Uint8Array> {
    const key = handle(input.objectHandle);
    if (!Number.isSafeInteger(input.maximumBytes) || input.maximumBytes < 1) throw new FileCenterError("file_center_invalid_input");
    try {
      const result = await this.#client.getObject({ Bucket: this.#bucket, Key: key, Range: `bytes=0-${String(input.maximumBytes)}`, Region: this.#region });
      const bytes = new Uint8Array(result.Body);
      if (bytes.byteLength > input.maximumBytes) throw new FileCenterError("file_center_policy_rejected");
      return bytes;
    } catch (error) {
      if (error instanceof FileCenterError) throw error;
      throw providerFailure(error, true);
    }
  }

  async quarantineObject(input: Parameters<StorageAdapter["quarantineObject"]>[0]): Promise<void> {
    const key = handle(input.objectHandle);
    const quarantineKey = `quarantine/${createHash("sha256").update(key).digest("hex")}`;
    const source = await this.inspectObject({ objectHandle: key });
    if (!source.exists) {
      try { await this.#client.headObject({ Bucket: this.#bucket, Key: quarantineKey, Region: this.#region }); return; }
      catch (error) { throw providerFailure(error); }
    }
    try {
      await this.#client.putObjectCopy({ Bucket: this.#bucket, CopySource: `${this.#bucket}.cos.${this.#region}.myqcloud.com/${key}`, Key: quarantineKey, Region: this.#region });
      await this.#client.deleteObject({ Bucket: this.#bucket, Key: key, Region: this.#region });
    } catch (error) { throw providerFailure(error); }
  }

  async deleteObject(input: Parameters<StorageAdapter["deleteObject"]>[0]): Promise<void> {
    const key = handle(input.objectHandle);
    try { await this.#client.deleteObject({ Bucket: this.#bucket, Key: key, Region: this.#region }); }
    catch (error) { throw providerFailure(error); }
  }
}

export function createTencentCosStorageAdapter(options: Omit<CosStorageAdapterOptions, "client"> & { readonly secretId: string; readonly secretKey: string; readonly timeoutMs: number }): TencentCosStorageAdapter {
  const client = new COS({ KeepAlive: true, SecretId: options.secretId, SecretKey: options.secretKey, StrictSsl: true, Timeout: options.timeoutMs });
  return new TencentCosStorageAdapter({ ...options, client });
}
