import { describe, expect, it } from "vitest";

import { readSecretFile, type SecretFileInfo, type SecretFileSystem } from "./index.js";

const fileSystem = (
  info: Partial<SecretFileInfo> = {},
  contents = "synthetic-secret\n",
): SecretFileSystem => ({
  inspect: () => Promise.resolve({
    isFile: true,
    isSymbolicLink: false,
    mode: 0o100400,
    size: Buffer.byteLength(contents),
    ...info,
  }),
  read: () => Promise.resolve(contents),
});

describe("Secret file loading", () => {
  it("reads one bounded line and removes only its final line ending", async () => {
    await expect(readSecretFile("AI_CRM_PASSWORD_FILE", "/secret", {
      enforcePermissions: true,
      fileSystem: fileSystem(),
    })).resolves.toBe("synthetic-secret");
  });

  it("does not repeat an invalid reference name", async () => {
    const unsafeReference = "do-not-repeat-secret_FILE";
    const error = await readSecretFile(unsafeReference, "/secret", {
      fileSystem: fileSystem(),
    }).catch((failure: unknown) => failure);

    expect(error).toMatchObject({
      code: "invalid_schema",
      variable: "INVALID_CONFIGURATION_VARIABLE",
    });
    expect(String(error)).not.toContain("do-not-repeat");
  });

  it.each([
    [{ isFile: false }, "secret_unreadable"],
    [{ isSymbolicLink: true }, "secret_unreadable"],
    [{ mode: 0o100444 }, "secret_permissions"],
  ] as const)("rejects unsupported file metadata", async (info, code) => {
    await expect(readSecretFile("AI_CRM_PASSWORD_FILE", "/secret", {
      enforcePermissions: true,
      fileSystem: fileSystem(info),
    })).rejects.toMatchObject({ code });
  });

  it.each(["", "   \n", "first\nsecond\n", "value\0suffix"])(
    "rejects empty, multiline, or invalid Secret content",
    async (contents) => {
      await expect(readSecretFile("AI_CRM_PASSWORD_FILE", "/secret", {
        fileSystem: fileSystem({}, contents),
      })).rejects.toMatchObject({
        code: expect.stringMatching(/invalid_value|secret_unreadable/) as unknown as string,
      });
    },
  );

  it("maps file-system failures to a safe error without paths or causes", async () => {
    const unavailable: SecretFileSystem = {
      inspect: () => Promise.reject(new Error("do-not-repeat internal path")),
      read: () => Promise.resolve(""),
    };
    const error = await readSecretFile("AI_CRM_PASSWORD_FILE", "/sensitive/path", {
      fileSystem: unavailable,
    }).catch((failure: unknown) => failure);

    expect(error).toMatchObject({ code: "secret_unreadable", variable: "AI_CRM_PASSWORD_FILE" });
    expect(String(error)).not.toContain("/sensitive/path");
    expect(String(error)).not.toContain("do-not-repeat");
    expect((error as Error).cause).toBeUndefined();
  });

  it("rejects oversized content before and after reading", async () => {
    await expect(readSecretFile("AI_CRM_PASSWORD_FILE", "/secret", {
      fileSystem: fileSystem({ size: 10 }),
      maxBytes: 5,
    })).rejects.toMatchObject({ code: "secret_unreadable" });

    await expect(readSecretFile("AI_CRM_PASSWORD_FILE", "/secret", {
      fileSystem: fileSystem({ size: 1 }, "too-long"),
      maxBytes: 4,
    })).rejects.toMatchObject({ code: "secret_unreadable" });
  });

  it("uses one opened handle for metadata and bounded content reads", async () => {
    const calls: string[] = [];
    const singleHandle: SecretFileSystem = {
      inspect: () => Promise.reject(new Error("path inspection must not be used")),
      read: () => Promise.reject(new Error("path read must not be used")),
      open: () => Promise.resolve({
        close: () => { calls.push("close"); return Promise.resolve(); },
        inspect: () => { calls.push("inspect"); return Promise.resolve({ isFile: true, isSymbolicLink: false, mode: 0o100400, size: 9 }); },
        read: (maxBytes) => { calls.push(`read:${String(maxBytes)}`); return Promise.resolve("synthetic"); },
      }),
    };
    await expect(readSecretFile("AI_CRM_PASSWORD_FILE", "/secret", { fileSystem: singleHandle, maxBytes: 16 })).resolves.toBe("synthetic");
    expect(calls).toEqual(["inspect", "read:16", "close"]);
  });
});
