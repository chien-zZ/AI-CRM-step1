import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { FileCenterError } from "./errors.js";
import type { StorageAdapter, StorageObjectMetadata } from "./types.js";

const HANDLE = /^objects\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/u;
const META_SUFFIX = ".metadata.json";
interface LocalMetadata { readonly checksumSha256: string; readonly detectedMediaType: string; readonly sizeBytes: number }

export class LocalFileStorageAdapter implements StorageAdapter {
  readonly #root: string;
  readonly #grantUrl: (input: { readonly declaredMediaType: string; readonly declaredSizeBytes: number; readonly expiresAt: string; readonly kind: "upload"; readonly objectHandle: string } | { readonly contentDisposition: string; readonly expiresAt: string; readonly kind: "download"; readonly objectHandle: string }) => string;

  constructor(options: { readonly grantUrl: (input: { readonly declaredMediaType: string; readonly declaredSizeBytes: number; readonly expiresAt: string; readonly kind: "upload"; readonly objectHandle: string } | { readonly contentDisposition: string; readonly expiresAt: string; readonly kind: "download"; readonly objectHandle: string }) => string; readonly rootDirectory: string }) {
    this.#root = resolve(options.rootDirectory);
    this.#grantUrl = options.grantUrl;
  }

  async #controlledPath(parts: readonly string[]): Promise<string> {
    await mkdir(this.#root, { recursive: true });
    const root = await realpath(this.#root);
    const target = resolve(root, ...parts);
    const relation = relative(root, target);
    if (relation.startsWith(`..${sep}`) || relation === ".." || resolve(target) === root) throw new FileCenterError("file_center_invalid_input");
    let cursor = root;
    const directories = relation.split(sep).slice(0, -1);
    for (const directory of directories) {
      cursor = join(cursor, directory);
      try { const info = await lstat(cursor); if (info.isSymbolicLink() || !info.isDirectory()) throw new FileCenterError("file_center_storage_unavailable", { retryable: true }); }
      catch (error) { if ((error as { code?: unknown }).code !== "ENOENT") throw error; await mkdir(cursor); const created = await lstat(cursor); if (created.isSymbolicLink() || !created.isDirectory()) throw new FileCenterError("file_center_storage_unavailable", { retryable: true }); }
      const resolved = await realpath(cursor); if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) throw new FileCenterError("file_center_storage_unavailable", { retryable: true });
    }
    return target;
  }
  async #path(handle: string): Promise<string> { if (!HANDLE.test(handle)) throw new FileCenterError("file_center_invalid_input"); return this.#controlledPath(handle.split("/")); }
  async #quarantinePath(handle: string): Promise<string> { return this.#controlledPath(["quarantine", createHash("sha256").update(handle).digest("hex")]); }
  async #fileState(path: string): Promise<"file" | "missing"> { try { const info = await lstat(path); if (info.isSymbolicLink() || !info.isFile()) throw new FileCenterError("file_center_storage_unavailable", { retryable: true }); return "file"; } catch (error) { if ((error as { code?: unknown }).code === "ENOENT") return "missing"; throw error; } }
  async createUploadGrant(input: Parameters<StorageAdapter["createUploadGrant"]>[0]) { await this.#path(input.objectHandle); return { headers: { "content-type": input.declaredMediaType, "x-file-size": String(input.declaredSizeBytes) }, url: this.#grantUrl({ declaredMediaType: input.declaredMediaType, declaredSizeBytes: input.declaredSizeBytes, expiresAt: input.expiresAt, kind: "upload", objectHandle: input.objectHandle }) }; }
  async createDownloadGrant(input: Parameters<StorageAdapter["createDownloadGrant"]>[0]) { const path = await this.#path(input.objectHandle); try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new FileCenterError("file_center_storage_unavailable", { retryable: true }); } catch (error) { if ((error as { code?: unknown }).code === "ENOENT") throw new FileCenterError("file_center_not_found"); throw error; } return { url: this.#grantUrl({ contentDisposition: input.contentDisposition, expiresAt: input.expiresAt, kind: "download", objectHandle: input.objectHandle }) }; }
  async inspectObject(input: { readonly objectHandle: string }): Promise<StorageObjectMetadata> { const path = await this.#path(input.objectHandle); try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new FileCenterError("file_center_storage_unavailable", { retryable: true }); const metadata = JSON.parse(await readFile(`${path}${META_SUFFIX}`, "utf8")) as LocalMetadata; return { checksumSha256: metadata.checksumSha256, detectedMediaType: metadata.detectedMediaType, exists: true, sizeBytes: info.size }; } catch (error) { if ((error as { code?: unknown }).code === "ENOENT") return { exists: false }; throw error; } }
  async readObject(input: { readonly maximumBytes: number; readonly objectHandle: string }): Promise<Uint8Array> {
    if (!Number.isSafeInteger(input.maximumBytes) || input.maximumBytes <= 0) throw new FileCenterError("file_center_invalid_input");
    const path = await this.#path(input.objectHandle); if (await this.#fileState(path) !== "file") throw new FileCenterError("file_center_not_found"); const file = await open(path, "r");
    try {
      const initial = await file.stat(); if (!initial.isFile() || initial.size > input.maximumBytes) throw new FileCenterError("file_center_policy_rejected");
      const chunks: Uint8Array[] = []; let total = 0;
      while (total <= input.maximumBytes) { const remaining = input.maximumBytes - total + 1; const buffer = Buffer.allocUnsafe(Math.min(65_536, remaining)); const result = await file.read(buffer, 0, buffer.byteLength, null); if (result.bytesRead === 0) break; total += result.bytesRead; if (total > input.maximumBytes) throw new FileCenterError("file_center_policy_rejected"); chunks.push(buffer.subarray(0, result.bytesRead)); }
      return Buffer.concat(chunks, total);
    } finally { await file.close(); }
  }
  async deleteObject(input: { readonly objectHandle: string }): Promise<void> { const path = await this.#path(input.objectHandle); const quarantined = await this.#quarantinePath(input.objectHandle); await rm(path, { force: true }); await rm(`${path}${META_SUFFIX}`, { force: true }); await rm(quarantined, { force: true }); await rm(`${quarantined}${META_SUFFIX}`, { force: true }); }
  async quarantineObject(input: { readonly objectHandle: string }): Promise<void> {
    const path = await this.#path(input.objectHandle); const metadata = `${path}${META_SUFFIX}`; const target = await this.#quarantinePath(input.objectHandle); const targetMetadata = `${target}${META_SUFFIX}`;
    const [sourceState, sourceMetadataState, targetState, targetMetadataState] = await Promise.all([this.#fileState(path), this.#fileState(metadata), this.#fileState(target), this.#fileState(targetMetadata)]);
    if (sourceState === "file" && targetState === "missing") { if (sourceMetadataState !== "file" || targetMetadataState !== "missing") throw new FileCenterError("file_center_storage_unavailable", { retryable: true }); await rename(path, target); await rename(metadata, targetMetadata); return; }
    if (sourceState === "missing" && targetState === "file") { if (targetMetadataState === "file" && sourceMetadataState === "missing") return; if (targetMetadataState === "missing" && sourceMetadataState === "file") { await rename(metadata, targetMetadata); return; } throw new FileCenterError("file_center_storage_unavailable", { retryable: true }); }
    throw new FileCenterError("file_center_storage_unavailable", { retryable: true });
  }

  async writeObjectForDevelopment(input: { readonly bytes: Uint8Array; readonly detectedMediaType: string; readonly objectHandle: string }): Promise<void> {
    const path = await this.#path(input.objectHandle); try { await lstat(path); throw new FileCenterError("file_center_operation_conflict"); } catch (error) { if ((error as { code?: unknown }).code !== "ENOENT") throw error; }
    const checksumSha256 = createHash("sha256").update(input.bytes).digest("hex"); await writeFile(path, input.bytes, { flag: "wx" }); await writeFile(`${path}${META_SUFFIX}`, JSON.stringify({ checksumSha256, detectedMediaType: input.detectedMediaType, sizeBytes: input.bytes.byteLength } satisfies LocalMetadata), { encoding: "utf8", flag: "wx" });
  }
}
