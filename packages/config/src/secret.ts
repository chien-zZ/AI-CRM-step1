import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";

import { configurationError } from "./errors.js";

export interface SecretFileInfo {
  readonly isFile: boolean;
  readonly isSymbolicLink: boolean;
  readonly mode: number;
  readonly size: number;
}

export interface SecretFileSystem {
  open?(filePath: string): Promise<SecretFileHandle>;
  inspect(filePath: string): Promise<SecretFileInfo>;
  read(filePath: string): Promise<string>;
}

export interface SecretFileHandle {
  close(): Promise<void>;
  inspect(): Promise<SecretFileInfo>;
  read(maxBytes: number): Promise<string>;
}

export interface SecretFilePolicy {
  readonly enforcePermissions?: boolean;
  readonly fileSystem?: SecretFileSystem;
  readonly maxBytes?: number;
}

const nodeFileSystem: SecretFileSystem = {
  open: async (filePath) => {
    const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    return {
      close: async () => handle.close(),
      inspect: async () => {
        const stats = await handle.stat();
        return { isFile: stats.isFile(), isSymbolicLink: stats.isSymbolicLink(), mode: stats.mode, size: stats.size };
      },
      read: async (maxBytes) => {
        const buffer = Buffer.allocUnsafe(maxBytes + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
        if (bytesRead > maxBytes) throw new Error("secret_file_too_large");
        return buffer.subarray(0, bytesRead).toString("utf8");
      },
    };
  },
  inspect: async (filePath) => {
    const stats = await lstat(filePath);
    return {
      isFile: stats.isFile(),
      isSymbolicLink: stats.isSymbolicLink(),
      mode: stats.mode,
      size: stats.size,
    };
  },
  read: async (filePath) => readFile(filePath, "utf8"),
};

const VARIABLE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const RESTRICTED_MODES = new Set([0o400, 0o440]);

export const readSecretFile = async (
  referenceVariable: string,
  filePath: string,
  policy: SecretFilePolicy = {},
): Promise<string> => {
  if (!VARIABLE_PATTERN.test(referenceVariable) || !referenceVariable.endsWith("_FILE")) {
    throw configurationError("invalid_schema", referenceVariable);
  }
  if (filePath.length === 0 || filePath.length > 4096 || /[\0\r\n]/.test(filePath)) {
    throw configurationError("invalid_value", referenceVariable);
  }

  const fileSystem = policy.fileSystem ?? nodeFileSystem;
  const maxBytes = policy.maxBytes ?? 4096;
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1_048_576) {
    throw configurationError("invalid_schema", referenceVariable);
  }

  let info: SecretFileInfo;
  let contents: string;
  if (fileSystem.open) {
    let handle: SecretFileHandle | undefined;
    try {
      handle = await fileSystem.open(filePath);
      info = await handle.inspect();
      if (info.isSymbolicLink || !info.isFile || info.size < 1 || info.size > maxBytes) {
        throw configurationError("secret_unreadable", referenceVariable);
      }
      if (policy.enforcePermissions === true && !RESTRICTED_MODES.has(info.mode & 0o777)) {
        throw configurationError("secret_permissions", referenceVariable);
      }
      contents = await handle.read(maxBytes);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error &&
        ((error as { code?: unknown }).code === "secret_permissions" || (error as { code?: unknown }).code === "secret_unreadable")) throw error;
      throw configurationError("secret_unreadable", referenceVariable);
    } finally {
      await handle?.close().catch(() => undefined);
    }
  } else {
    try {
      info = await fileSystem.inspect(filePath);
    } catch {
      throw configurationError("secret_unreadable", referenceVariable);
    }
    if (info.isSymbolicLink || !info.isFile || info.size < 1 || info.size > maxBytes) {
      throw configurationError("secret_unreadable", referenceVariable);
    }
    if (policy.enforcePermissions === true && !RESTRICTED_MODES.has(info.mode & 0o777)) {
      throw configurationError("secret_permissions", referenceVariable);
    }
    try {
      contents = await fileSystem.read(filePath);
    } catch {
      throw configurationError("secret_unreadable", referenceVariable);
    }
  }
  if (Buffer.byteLength(contents, "utf8") > maxBytes) {
    throw configurationError("secret_unreadable", referenceVariable);
  }
  const value = contents.replace(/\r?\n$/, "");
  if (value.trim().length === 0 || /[\0\r\n]/.test(value)) {
    throw configurationError("invalid_value", referenceVariable);
  }
  return value;
};
