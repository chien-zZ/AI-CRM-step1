import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { FileCenterError } from "./errors.js";
import type { StorageAdapter, StorageObjectMetadata } from "./types.js";

const HANDLE = /^objects\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/u;
const META_SUFFIX = ".metadata.json";
interface LocalMetadata { readonly checksumSha256: string; readonly detectedMediaType: string; readonly sizeBytes: number }

export class LocalFileStorageAdapter implements StorageAdapter {
  readonly #root: string;
  readonly #grantUrl: (input: { readonly expiresAt: string; readonly kind: "download" | "upload"; readonly objectHandle: string }) => string;

  constructor(options: { readonly grantUrl: (input: { readonly expiresAt: string; readonly kind: "download" | "upload"; readonly objectHandle: string }) => string; readonly rootDirectory: string }) {
    this.#root = resolve(options.rootDirectory);
    this.#grantUrl = options.grantUrl;
  }

  async #path(handle: string): Promise<string> {
    if (!HANDLE.test(handle)) throw new FileCenterError("file_center_invalid_input");
    await mkdir(this.#root, { recursive: true });
    const root = await realpath(this.#root);
    const target = resolve(root, ...handle.split("/"));
    const relation = relative(root, target);
    if (relation.startsWith(`..${sep}`) || relation === ".." || resolve(target) === root) throw new FileCenterError("file_center_invalid_input");
    let cursor = dirname(target);
    const missing: string[] = [];
    while (cursor !== root) {
      try { const info = await lstat(cursor); if (info.isSymbolicLink() || !info.isDirectory()) throw new FileCenterError("file_center_storage_unavailable"); break; }
      catch (error) { if ((error as { code?: unknown }).code !== "ENOENT") throw error; missing.push(cursor); cursor = dirname(cursor); }
    }
    for (const directory of missing.reverse()) await mkdir(directory);
    if (!(await realpath(dirname(target))).startsWith(`${root}${sep}`)) throw new FileCenterError("file_center_storage_unavailable");
    return target;
  }
  async createUploadGrant(input: Parameters<StorageAdapter["createUploadGrant"]>[0]) { await this.#path(input.objectHandle); return { headers: { "content-type": input.declaredMediaType, "x-file-size": String(input.declaredSizeBytes) }, url: this.#grantUrl({ expiresAt: input.expiresAt, kind: "upload", objectHandle: input.objectHandle }) }; }
  async createDownloadGrant(input: Parameters<StorageAdapter["createDownloadGrant"]>[0]) { const path = await this.#path(input.objectHandle); try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new FileCenterError("file_center_storage_unavailable"); } catch (error) { if ((error as { code?: unknown }).code === "ENOENT") throw new FileCenterError("file_center_not_found"); throw error; } return { url: this.#grantUrl({ expiresAt: input.expiresAt, kind: "download", objectHandle: input.objectHandle }) }; }
  async inspectObject(input: { readonly objectHandle: string }): Promise<StorageObjectMetadata> { const path = await this.#path(input.objectHandle); try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new FileCenterError("file_center_storage_unavailable"); const metadata = JSON.parse(await readFile(`${path}${META_SUFFIX}`, "utf8")) as LocalMetadata; return { checksumSha256: metadata.checksumSha256, detectedMediaType: metadata.detectedMediaType, exists: true, sizeBytes: info.size }; } catch (error) { if ((error as { code?: unknown }).code === "ENOENT") return { exists: false }; throw error; } }
  async readObject(input: { readonly objectHandle: string }): Promise<Uint8Array> { const path = await this.#path(input.objectHandle); const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new FileCenterError("file_center_storage_unavailable"); return readFile(path); }
  async deleteObject(input: { readonly objectHandle: string }): Promise<void> { const path = await this.#path(input.objectHandle); await rm(path, { force: true }); await rm(`${path}${META_SUFFIX}`, { force: true }); const quarantined = join(this.#root, "quarantine", createHash("sha256").update(input.objectHandle).digest("hex")); await rm(quarantined, { force: true }); await rm(`${quarantined}${META_SUFFIX}`, { force: true }); }
  async quarantineObject(input: { readonly objectHandle: string }): Promise<void> { const path = await this.#path(input.objectHandle); const target = join(this.#root, "quarantine", createHash("sha256").update(input.objectHandle).digest("hex")); await mkdir(dirname(target), { recursive: true }); try { await rename(path, target); await rename(`${path}${META_SUFFIX}`, `${target}${META_SUFFIX}`); } catch (error) { if ((error as { code?: unknown }).code === "ENOENT" && (await stat(target).catch(() => undefined))?.isFile()) return; throw error; } }

  async writeObjectForDevelopment(input: { readonly bytes: Uint8Array; readonly detectedMediaType: string; readonly objectHandle: string }): Promise<void> {
    const path = await this.#path(input.objectHandle); try { await lstat(path); throw new FileCenterError("file_center_operation_conflict"); } catch (error) { if ((error as { code?: unknown }).code !== "ENOENT") throw error; }
    const checksumSha256 = createHash("sha256").update(input.bytes).digest("hex"); await writeFile(path, input.bytes, { flag: "wx" }); await writeFile(`${path}${META_SUFFIX}`, JSON.stringify({ checksumSha256, detectedMediaType: input.detectedMediaType, sizeBytes: input.bytes.byteLength } satisfies LocalMetadata), { encoding: "utf8", flag: "wx" });
  }
}
