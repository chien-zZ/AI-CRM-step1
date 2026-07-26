import { createServer, type Server } from "node:http";

import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createOidcTokenVerifier } from "./verifier.js";

const audience = "ai-crm-api";
const clientId = "pc-web";
let issuer = "";
let jwksUri = "";
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let server: Server;

async function sign(overrides: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    aud: audience,
    azp: clientId,
    exp: now + 300,
    iat: now,
    iss: issuer,
    sub: "synthetic-subject",
    ...overrides,
  };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "JWT" })
    .sign(privateKey);
}

function verifier() {
  return createOidcTokenVerifier({
    audience,
    clientId,
    clockToleranceSeconds: 5,
    issuer,
    jwksCacheMaxAgeMs: 60_000,
    jwksCooldownMs: 1_000,
    jwksTimeoutMs: 1_000,
    jwksUri,
  });
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "test-key", use: "sig" };
  server = createServer((request, response) => {
    if (request.url !== "/jwks") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test JWKS server did not bind a TCP port.");
  issuer = `http://127.0.0.1:${String(address.port)}/realms/ai-crm-test`;
  jwksUri = `http://127.0.0.1:${String(address.port)}/jwks`;
});

afterAll(async () => new Promise<void>((resolve, reject) => {
  server.close((error) => {
    if (error) reject(error);
    else resolve();
  });
}));

describe("createOidcTokenVerifier", () => {
  it("verifies a signed token and exposes only the transport-neutral principal", async () => {
    const token = await sign({ realm_access: { roles: ["not-a-business-permission"] } });

    const principal = await verifier().verify(token);
    expect(principal.authenticationSubject).toEqual({ issuer, subject: "synthetic-subject" });
    expect(principal.clientId).toBe(clientId);
    expect(Number.isNaN(Date.parse(principal.expiresAt))).toBe(false);
    expect(Number.isNaN(Date.parse(principal.issuedAt))).toBe(false);
  });

  it.each([
    ["wrong audience", { aud: "another-api" }],
    ["wrong authorized party", { azp: "another-client" }],
    ["missing authorized party", { azp: undefined }],
    ["missing subject", { sub: undefined }],
  ])("fails closed for %s", async (_name, claims) => {
    await expect(verifier().verify(await sign(claims))).rejects.toMatchObject({ code: "token_invalid" });
  });

  it("classifies expiration without returning token details", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await sign({ exp: now - 60, iat: now - 120 });

    await expect(verifier().verify(token)).rejects.toMatchObject({
      code: "token_expired",
      message: "The authentication token has expired.",
    });
  });

  it.each([
    ["issued after expiration", { exp: Math.floor(Date.now() / 1000) + 60, iat: Math.floor(Date.now() / 1000) + 61 }],
    ["issued too far in the future", { iat: Math.floor(Date.now() / 1000) + 60 }],
  ])("rejects a token %s", async (_name, claims) => {
    await expect(verifier().verify(await sign(claims))).rejects.toMatchObject({ code: "token_invalid" });
  });

  it("rejects an invalid signature", async () => {
    const pair = await generateKeyPair("RS256");
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      aud: audience,
      azp: clientId,
      exp: now + 60,
      iat: now,
      iss: issuer,
      sub: "synthetic",
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .sign(pair.privateKey);

    await expect(verifier().verify(token)).rejects.toMatchObject({ code: "token_invalid" });
  });

  it("classifies a JWKS timeout as a closed dependency failure", async () => {
    const timeoutServer = createServer(() => undefined);
    await new Promise<void>((resolve) => timeoutServer.listen(0, "127.0.0.1", resolve));
    const address = timeoutServer.address();
    if (!address || typeof address === "string") throw new Error("Timeout test server did not bind a TCP port.");
    const timeoutVerifier = createOidcTokenVerifier({
      audience,
      clientId,
      clockToleranceSeconds: 5,
      issuer,
      jwksCacheMaxAgeMs: 60_000,
      jwksCooldownMs: 1_000,
      jwksTimeoutMs: 25,
      jwksUri: `http://127.0.0.1:${String(address.port)}/jwks`,
    });

    await expect(timeoutVerifier.verify(await sign())).rejects.toMatchObject({
      code: "identity_provider_unavailable",
    });
    timeoutServer.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      timeoutServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });

  it("rejects insecure non-loopback endpoints before any network request", () => {
    expect(() => createOidcTokenVerifier({
      audience,
      clientId,
      clockToleranceSeconds: 5,
      issuer: "http://identity.example.test/realms/ai-crm",
      jwksCacheMaxAgeMs: 60_000,
      jwksCooldownMs: 1_000,
      jwksTimeoutMs: 1_000,
      jwksUri: "http://identity.example.test/jwks",
    })).toThrow("must use HTTPS");
  });
});
