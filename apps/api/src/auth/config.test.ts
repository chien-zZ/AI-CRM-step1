import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { loadPcBffConfiguration } from "./config.js";

const encryptionKey = Buffer.alloc(32, 7).toString("base64url");
const indexingKey = Buffer.alloc(32, 9).toString("base64url");
const previousEncryptionKey = Buffer.alloc(32, 11).toString("base64url");
const secrets: Readonly<Record<string, string>> = Object.freeze({
  "/run/secrets/client": "c".repeat(43),
  "/run/secrets/encryption": encryptionKey,
  "/run/secrets/index": indexingKey,
  "/run/secrets/previous-encryption": previousEncryptionKey,
  "/run/secrets/redis": "synthetic-redis-secret",
});

const secretFilePolicy = {
  fileSystem: {
    inspect: (filePath: string) => Promise.resolve({
      isFile: filePath in secrets,
      isSymbolicLink: false,
      mode: 0o400,
      size: Buffer.byteLength(secrets[filePath] ?? "", "utf8"),
    }),
    read: (filePath: string) => Promise.resolve(secrets[filePath] ?? ""),
  },
} as const;

const validEnvironment: NodeJS.ProcessEnv = {
  AI_CRM_KEYCLOAK_ISSUER: "http://127.0.0.1:8080/realms/ai-crm-dev",
  AI_CRM_OIDC_API_AUDIENCE: "ai-crm-api",
  AI_CRM_PC_ALLOWED_ORIGIN: "http://127.0.0.1:8088",
  AI_CRM_PC_LOGIN_TRANSACTION_TTL_SECONDS: "180",
  AI_CRM_PC_OIDC_CLIENT_ID: "ai-crm-pc-bff",
  AI_CRM_PC_OIDC_CLIENT_SECRET_FILE: "/run/secrets/client",
  AI_CRM_PC_OIDC_REDIRECT_URI: "http://127.0.0.1:8088/auth/pc/callback",
  AI_CRM_PC_OIDC_TIMEOUT_SECONDS: "5",
  AI_CRM_PC_REFRESH_LEASE_TTL_MS: "10000",
  AI_CRM_PC_SESSION_ABSOLUTE_TTL_SECONDS: "28800",
  AI_CRM_PC_SESSION_ENCRYPTION_KEY_FILE: "/run/secrets/encryption",
  AI_CRM_PC_SESSION_ENCRYPTION_KEY_ID: "pc-session-2026-01",
  AI_CRM_PC_SESSION_IDLE_TTL_SECONDS: "1800",
  AI_CRM_PC_SESSION_INDEX_KEY_FILE: "/run/secrets/index",
  AI_CRM_REDIS_CONNECT_TIMEOUT_MS: "1000",
  AI_CRM_REDIS_PASSWORD_FILE: "/run/secrets/redis",
  AI_CRM_REDIS_URL: "redis://127.0.0.1:6379",
  NODE_ENV: "test",
};

describe("loadPcBffConfiguration", () => {
  it("loads explicit TTLs and secret file references", async () => {
    const config = await loadPcBffConfiguration({ env: validEnvironment, secretFilePolicy });

    expect(config.allowedOrigin).toBe("http://127.0.0.1:8088");
    expect(config.keycloakAudience).toBe("ai-crm-api");
    expect(config.sessionEncryptionKey.value).toHaveLength(32);
    expect(config.sessionDecryptionKeys).toHaveLength(1);
    expect(config.sessionIndexingKey).toHaveLength(32);
    expect(config.sessionIdleTtlSeconds).toBe(1800);
    expect(config.sessionAbsoluteTtlSeconds).toBe(28800);
  });

  it("loads one bounded previous decryption key during a rotation window", async () => {
    const config = await loadPcBffConfiguration({
      env: {
        ...validEnvironment,
        AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_FILE: "/run/secrets/previous-encryption",
        AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_ID: "pc-session-2025-12",
      },
      secretFilePolicy,
    });

    expect(config.sessionEncryptionKey.id).toBe("pc-session-2026-01");
    expect(config.sessionDecryptionKeys.map((key) => key.id))
      .toEqual(["pc-session-2026-01", "pc-session-2025-12"]);
  });

  it("rejects an incomplete or reused previous encryption key", async () => {
    await expect(loadPcBffConfiguration({
      env: {
        ...validEnvironment,
        AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_FILE: "/run/secrets/previous-encryption",
      },
      secretFilePolicy,
    })).rejects.toMatchObject({ code: "authentication_session_invalid" });

    await expect(loadPcBffConfiguration({
      env: {
        ...validEnvironment,
        AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_FILE: "/run/secrets/encryption",
        AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_ID: "pc-session-previous",
      },
      secretFilePolicy,
    })).rejects.toMatchObject({ code: "authentication_session_invalid" });

    await expect(loadPcBffConfiguration({
      env: {
        ...validEnvironment,
        AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_FILE: "/run/secrets/previous-encryption",
        AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_ID: "pc-session-2026-01",
      },
      secretFilePolicy,
    })).rejects.toMatchObject({ code: "authentication_session_invalid" });
  });

  it("rejects an absolute TTL shorter than the idle TTL", async () => {
    await expect(loadPcBffConfiguration({
      env: { ...validEnvironment, AI_CRM_PC_SESSION_ABSOLUTE_TTL_SECONDS: "600" },
      secretFilePolicy,
    })).rejects.toMatchObject({ code: "authentication_session_invalid" });
  });

  it("rejects non-loopback HTTP identity endpoints", async () => {
    await expect(loadPcBffConfiguration({
      env: { ...validEnvironment, AI_CRM_KEYCLOAK_ISSUER: "http://identity.example.test/realms/ai-crm" },
      secretFilePolicy,
    })).rejects.toMatchObject({ code: "authentication_session_invalid" });
  });

  it("rejects reuse of one key for encryption and session indexing", async () => {
    const sharedKeyPolicy = {
      fileSystem: {
        ...secretFilePolicy.fileSystem,
        read: (filePath: string) => Promise.resolve(
          filePath === "/run/secrets/index" ? encryptionKey : secrets[filePath] ?? "",
        ),
      },
    } as const;

    await expect(loadPcBffConfiguration({ env: validEnvironment, secretFilePolicy: sharedKeyPolicy }))
      .rejects.toMatchObject({ code: "authentication_session_invalid" });
  });

  it("rejects a weak OIDC Client Secret", async () => {
    const weakClientSecretPolicy = {
      fileSystem: {
        ...secretFilePolicy.fileSystem,
        read: (filePath: string) => Promise.resolve(
          filePath === "/run/secrets/client" ? "too-short" : secrets[filePath] ?? "",
        ),
      },
    } as const;

    await expect(loadPcBffConfiguration({ env: validEnvironment, secretFilePolicy: weakClientSecretPolicy }))
      .rejects.toMatchObject({ code: "authentication_session_invalid" });
  });
});
