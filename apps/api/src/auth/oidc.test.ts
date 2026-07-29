import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createOidcClient, type OidcClientPort } from "./oidc.js";

const clientId = "ai-crm-pc-bff";
const clientSecret = "synthetic-client-secret";
let issuer = "";
let client: OidcClientPort;
let server: Server;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let publicJwk: JWK;
let expectedNonce = "";
let sawBasicAuthentication = false;
let tokenRequestCount = 0;
let failNextTokenRequest = false;

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function tokenResponse(request: IncomingMessage, response: ServerResponse): Promise<void> {
  sawBasicAuthentication = request.headers.authorization?.startsWith("Basic ") === true;
  tokenRequestCount += 1;
  request.resume();
  if (failNextTokenRequest) {
    failNextTokenRequest = false;
    json(response, 503, { error: "temporarily_unavailable" });
    return;
  }
  if (tokenRequestCount > 1) {
    json(response, 200, {
      access_token: "access.refreshed",
      expires_in: 300,
      refresh_token: "refresh.refreshed",
      token_type: "Bearer",
    });
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const idToken = await new SignJWT({ auth_time: now, nonce: expectedNonce })
    .setProtectedHeader({ alg: "RS256", kid: "synthetic-key", typ: "JWT" })
    .setAudience(clientId)
    .setExpirationTime(now + 300)
    .setIssuedAt(now)
    .setIssuer(issuer)
    .setSubject("synthetic-subject")
    .sign(privateKey);
  json(response, 200, {
    access_token: "access.initial",
    expires_in: 300,
    id_token: idToken,
    refresh_token: "refresh.initial",
    token_type: "Bearer",
  });
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "synthetic-key", use: "sig" };
  server = createServer((request, response) => {
    void (async () => {
      const url = request.url ?? "";
      if (url === "/realms/test/.well-known/openid-configuration") {
        json(response, 200, {
          authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
          code_challenge_methods_supported: ["S256"],
          end_session_endpoint: `${issuer}/protocol/openid-connect/logout`,
          id_token_signing_alg_values_supported: ["RS256"],
          issuer,
          jwks_uri: `${issuer}/protocol/openid-connect/certs`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          token_endpoint: `${issuer}/protocol/openid-connect/token`,
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
        });
        return;
      }
      if (url === "/realms/test/protocol/openid-connect/certs") {
        json(response, 200, { keys: [publicJwk] });
        return;
      }
      if (url === "/realms/test/protocol/openid-connect/token" && request.method === "POST") {
        await tokenResponse(request, response);
        return;
      }
      response.writeHead(404);
      response.end();
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Synthetic OIDC server did not bind a TCP port.");
  issuer = `http://127.0.0.1:${String(address.port)}/realms/test`;
  client = await createOidcClient({
    clientId,
    clientSecret,
    issuer,
    redirectUri: "http://127.0.0.1:8088/auth/pc/callback",
    timeoutSeconds: 2,
  });
});

afterAll(async () => new Promise<void>((resolve, reject) => {
  server.close((error) => {
    if (error) reject(error);
    else resolve();
  });
}));

describe("createOidcClient", () => {
  it("builds authorization requests with PKCE, state, and nonce", async () => {
    const result = await client.beginLogin("/tasks?tab=assigned");
    const authorizationUrl = new URL(result.authorizationUrl);

    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(authorizationUrl.searchParams.get("state")).toBe(result.transaction.state);
    expect(authorizationUrl.searchParams.get("nonce")).toBe(result.transaction.nonce);
    expect(result.transaction.returnTo).toBe("/tasks?tab=assigned");
  });

  it("validates the callback and refreshes without exposing provider types", async () => {
    const login = await client.beginLogin("/tasks");
    expectedNonce = login.transaction.nonce;
    const callback = `http://127.0.0.1:8088/auth/pc/callback?code=synthetic&state=${login.transaction.state}`;
    const initial = await client.exchangeCallback(callback, login.transaction);
    const refreshed = await client.refresh(initial.tokens);

    expect(sawBasicAuthentication).toBe(true);
    expect(initial.tokens).toMatchObject({
      accessToken: "access.initial",
      refreshToken: "refresh.initial",
    });
    expect(refreshed.tokens).toMatchObject({
      accessToken: "access.refreshed",
      idToken: initial.tokens.idToken,
      refreshToken: "refresh.refreshed",
    });
    const logoutUrl = new URL(client.endSessionUrl() ?? "");
    expect(logoutUrl.origin + logoutUrl.pathname).toBe(`${issuer}/protocol/openid-connect/logout`);
    expect(logoutUrl.searchParams.get("client_id")).toBe(clientId);
    expect(logoutUrl.searchParams.has("id_token_hint")).toBe(false);
  });

  it("rejects callback state mismatch and external return URLs", async () => {
    const login = await client.beginLogin("/tasks");
    expectedNonce = login.transaction.nonce;

    await expect(client.exchangeCallback(
      "http://127.0.0.1:8088/auth/pc/callback?code=synthetic&state=wrong",
      login.transaction,
    )).rejects.toMatchObject({ code: "authentication_callback_invalid" });
    await expect(client.beginLogin("https://attacker.example.test/collect"))
      .rejects.toMatchObject({ code: "authentication_callback_invalid" });
    await expect(client.exchangeCallback("not a valid URL", login.transaction))
      .rejects.toMatchObject({ code: "authentication_callback_invalid" });
  });

  it("classifies a Token endpoint outage as a closed dependency failure", async () => {
    const login = await client.beginLogin("/tasks");
    expectedNonce = login.transaction.nonce;
    failNextTokenRequest = true;

    await expect(client.exchangeCallback(
      `http://127.0.0.1:8088/auth/pc/callback?code=synthetic&state=${login.transaction.state}`,
      login.transaction,
    )).rejects.toMatchObject({ code: "authentication_dependency_unavailable" });
  });
});
