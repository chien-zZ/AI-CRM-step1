import { createCipheriv, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  clearPcSessionCookie,
  createOpaqueCredential,
  createSessionIndex,
  decryptSessionTokens,
  encryptSessionTokens,
  serializePcSessionCookie,
  validateBrowserMutation,
} from "./session-security.js";

describe("BFF session security", () => {
  const sessionReference = "s".repeat(43);
  it("creates opaque credentials and irreversible keyed session indexes", () => {
    const credential = createOpaqueCredential();
    const anotherCredential = createOpaqueCredential();
    const key = randomBytes(32);

    expect(credential).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(anotherCredential).not.toBe(credential);
    expect(createSessionIndex(credential, key)).not.toContain(credential);
    expect(createSessionIndex(credential, key)).toBe(createSessionIndex(credential, key));
  });

  it("encrypts Keycloak tokens at the session-store boundary and supports key selection", () => {
    const key = { id: "session-key-2026-01", value: randomBytes(32) };
    const tokens = { accessToken: "access.synthetic", idToken: "identity.synthetic", refreshToken: "refresh.synthetic" };
    const encrypted = encryptSessionTokens(tokens, key, sessionReference);

    expect(encrypted.ciphertext).not.toContain("access.synthetic");
    expect(decryptSessionTokens(encrypted, [key], sessionReference)).toEqual(tokens);
    expect(() => decryptSessionTokens(encrypted, [{ id: "other-key", value: randomBytes(32) }], sessionReference))
      .toThrow("browser session is invalid");
    expect(() => decryptSessionTokens(encrypted, [key], "t".repeat(43)))
      .toThrow("browser session is invalid");
  });

  it("keeps existing v1 session envelopes readable during the v2 binding rollout", () => {
    const key = { id: "legacy-session-key", value: randomBytes(32) };
    const tokens = { accessToken: "legacy-access", refreshToken: "legacy-refresh" };
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key.value, initializationVector);
    cipher.setAAD(Buffer.from(`ai-crm:bff-session:v1:${key.id}`, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(tokens), "utf8")), cipher.final()]);
    const legacyEnvelope = {
      algorithm: "A256GCM",
      ciphertext: ciphertext.toString("base64url"),
      initializationVector: initializationVector.toString("base64url"),
      keyId: key.id,
      tag: cipher.getAuthTag().toString("base64url"),
      version: 1,
    };

    expect(decryptSessionTokens(legacyEnvelope, [key], sessionReference)).toEqual(tokens);
  });

  it("fails closed when an encrypted token set is modified", () => {
    const key = { id: "session-key-2026-01", value: randomBytes(32) };
    const encrypted = encryptSessionTokens({ accessToken: "access", refreshToken: "refresh" }, key, sessionReference);

    expect(() => decryptSessionTokens({ ...encrypted, ciphertext: `${encrypted.ciphertext}A` }, [key], sessionReference))
      .toThrow("browser session is invalid");
  });

  it("rejects unknown envelope versions and oversized ciphertext before decryption", () => {
    const key = { id: "session-key-2026-01", value: randomBytes(32) };
    const encrypted = encryptSessionTokens({ accessToken: "access", refreshToken: "refresh" }, key, sessionReference);

    expect(() => decryptSessionTokens({ ...encrypted, version: 3 }, [key], sessionReference))
      .toThrow("browser session is invalid");
    expect(() => decryptSessionTokens({ ...encrypted, ciphertext: "A".repeat(65_537) }, [key], sessionReference))
      .toThrow("browser session is invalid");
  });

  it("rejects token sets whose combined serialized size cannot fit the bounded session record", () => {
    const key = { id: "session-key-2026-01", value: randomBytes(32) };
    expect(() => encryptSessionTokens({
      accessToken: "a".repeat(16_384),
      idToken: "i".repeat(16_384),
      refreshToken: "r".repeat(16_384),
    }, key, sessionReference)).toThrow("browser session is invalid");
  });

  it("requires both an allowlisted origin and the session-bound CSRF value", () => {
    const valid = {
      allowedOrigins: ["https://workbench.example.test"],
      csrfHeader: "csrf-value-that-is-long-and-unpredictable",
      csrfSessionValue: "csrf-value-that-is-long-and-unpredictable",
      origin: "https://workbench.example.test",
      referer: undefined,
    } as const;

    expect(() => { validateBrowserMutation(valid); }).not.toThrow();
    expect(() => { validateBrowserMutation({ ...valid, origin: "https://attacker.example.test" }); })
      .toThrow("session security validation");
    expect(() => { validateBrowserMutation({ ...valid, csrfHeader: "different-value" }); })
      .toThrow("session security validation");
  });

  it("uses a valid same-origin Referer only when Origin is absent", () => {
    expect(() => { validateBrowserMutation({
      allowedOrigins: ["https://workbench.example.test"],
      csrfHeader: "csrf-value",
      csrfSessionValue: "csrf-value",
      origin: undefined,
      referer: "https://workbench.example.test/tasks/fixture",
    }); }).not.toThrow();
  });

  it("serializes host-only secure cookies without a Domain attribute", () => {
    const cookie = serializePcSessionCookie(createOpaqueCredential(), 900);

    expect(cookie).toContain("__Host-ai_crm_pc_session=");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Domain=");
    expect(clearPcSessionCookie()).toContain("Max-Age=0");
  });
});
