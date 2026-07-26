import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createOidcTokenVerifier } from "@ai-crm/platform-auth-context";
import { load } from "cheerio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPcAuthenticationHttpAdapter } from "./http-adapter.js";
import { createOidcClient } from "./oidc.js";
import type { LoginTransaction, OidcClientPort, OidcTokenResult } from "./oidc.js";
import type { SessionTokenSet } from "./session-security.js";
import { createPcBffSessionService } from "./session-service.js";
import { connectRedisSessionStore, createRedisBrowserSessionStore } from "./session-store.js";
import type { RedisSessionConnection } from "./session-store.js";

const issuer = process.env.TEST_AUTH_KEYCLOAK_ISSUER;
const adminSecretFile = process.env.TEST_AUTH_KEYCLOAK_ADMIN_SECRET_FILE;
const clientSecretFile = process.env.TEST_AUTH_KEYCLOAK_CLIENT_SECRET_FILE;
const redisUrl = process.env.TEST_AUTH_REDIS_URL;
const redisPasswordFile = process.env.TEST_AUTH_REDIS_PASSWORD_FILE;
const enabled = Boolean(issuer && adminSecretFile && clientSecretFile && redisUrl && redisPasswordFile);
const clientId = "ai-crm-pc-bff";
const apiAudience = "ai-crm-api";
const redirectUri = "http://127.0.0.1:8088/auth/pc/callback";

async function secret(filePath: string): Promise<string> {
  const value = (await readFile(resolve(filePath), "utf8")).trim();
  if (!value) throw new Error("Integration Secret file is empty.");
  return value;
}

class KeycloakBrowser {
  readonly cookies = new Map<string, string>();

  async request(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size > 0) {
      headers.set("cookie", [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    }
    const response = await fetch(url, { ...init, headers, redirect: "manual" });
    for (const header of response.headers.getSetCookie()) {
      const delimiter = header.indexOf(";");
      const pair = delimiter === -1 ? header : header.slice(0, delimiter);
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    return response;
  }

  async login(authorizationUrl: string, username: string, password: string): Promise<string> {
    const page = await this.request(authorizationUrl);
    if (page.status !== 200) throw new Error("Keycloak login page was unavailable.");
    const $ = load(await page.text());
    const form = $("#kc-form-login");
    const action = form.attr("action");
    if (!action) throw new Error("Keycloak login form was unavailable.");
    const body = new URLSearchParams();
    form.find('input[type="hidden"]').each((_index, input) => {
      const name = $(input).attr("name");
      if (name) body.set(name, $(input).attr("value") ?? "");
    });
    body.set("username", username);
    body.set("password", password);
    body.set("credentialId", "");

    let response = await this.request(action, {
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    for (let redirects = 0; redirects < 5; redirects += 1) {
      const location = response.headers.get("location");
      if (!location) {
        const responsePage = load(await response.text());
        const feedback = responsePage("#input-error, .kc-feedback-text").first().text().trim();
        const boundedFeedback = feedback.length > 0 && feedback.length <= 200 ? `: ${feedback}` : "";
        throw new Error(`Keycloak login did not return an authorization callback${boundedFeedback}.`);
      }
      const next = new URL(location, response.url);
      if (next.origin === new URL(redirectUri).origin && next.pathname === new URL(redirectUri).pathname) {
        return next.href;
      }
      response = await this.request(next.href);
    }
    throw new Error("Keycloak login exceeded the redirect limit.");
  }
}

async function createSyntheticUser(
  keycloakIssuer: string,
  adminPassword: string,
  username: string,
  password: string,
): Promise<{ readonly accessToken: string; readonly userId: string }> {
  const tokenResponse = await fetch(new URL("/realms/master/protocol/openid-connect/token", keycloakIssuer), {
    body: new URLSearchParams({
      client_id: "admin-cli",
      grant_type: "password",
      password: adminPassword,
      username: "dev_admin",
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  if (!tokenResponse.ok) throw new Error("Keycloak test administration authentication failed.");
  const token: unknown = await tokenResponse.json();
  if (!token || typeof token !== "object" || !("access_token" in token) || typeof token.access_token !== "string") {
    throw new Error("Keycloak test administration returned an invalid response.");
  }
  const accessToken = token.access_token;
  const createResponse = await fetch(new URL("/admin/realms/ai-crm-dev/users", keycloakIssuer), {
    body: JSON.stringify({
      credentials: [{ temporary: false, type: "password", value: password }],
      email: `${username}@example.test`,
      emailVerified: true,
      enabled: true,
      firstName: "Synthetic",
      lastName: "IAM01",
      username,
    }),
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    method: "POST",
  });
  const location = createResponse.headers.get("location");
  if (createResponse.status !== 201 || !location) throw new Error("Keycloak synthetic user creation failed.");
  const userId = new URL(location).pathname.split("/").at(-1);
  if (!userId) throw new Error("Keycloak synthetic user identifier was unavailable.");
  return { accessToken, userId };
}

describe.skipIf(!enabled)("Keycloak PC BFF integration", () => {
  let adminAccessToken = "";
  let browser: KeycloakBrowser;
  let cleanupConnection: Readonly<RedisSessionConnection> | undefined;
  let connection: Readonly<RedisSessionConnection>;
  let syntheticUserId = "";
  const username = `iam01-${randomBytes(8).toString("hex")}`;
  const password = randomBytes(24).toString("base64url");

  beforeAll(async () => {
    if (!issuer || !adminSecretFile || !clientSecretFile || !redisUrl || !redisPasswordFile) {
      throw new Error("All Keycloak and Redis integration settings are required.");
    }
    const created = await createSyntheticUser(issuer, await secret(adminSecretFile), username, password);
    adminAccessToken = created.accessToken;
    syntheticUserId = created.userId;
    connection = await connectRedisSessionStore({
      connectTimeoutMs: 2_000,
      password: await secret(redisPasswordFile),
      url: redisUrl,
    });
    cleanupConnection = connection;
    browser = new KeycloakBrowser();
  }, 20_000);

  afterAll(async () => {
    await cleanupConnection?.close();
    if (issuer && adminAccessToken && syntheticUserId) {
      const response = await fetch(new URL(`/admin/realms/ai-crm-dev/users/${syntheticUserId}`, issuer), {
        headers: { authorization: `Bearer ${adminAccessToken}` },
        method: "DELETE",
      });
      if (response.status !== 204) throw new Error("Keycloak synthetic user cleanup failed.");
    }
  });

  it("logs in, verifies the principal, rotates the session, and logs out", async () => {
    if (!issuer || !clientSecretFile) throw new Error("Keycloak integration settings are required.");
    const oidc = await createOidcClient({
      clientId,
      clientSecret: await secret(clientSecretFile),
      issuer,
      redirectUri,
      timeoutSeconds: 5,
    });
    let issuedIdToken: string | undefined;
    const observingOidc: OidcClientPort = Object.freeze({
      beginLogin: (returnTo: string) => oidc.beginLogin(returnTo),
      endSessionUrl: () => oidc.endSessionUrl(),
      exchangeCallback: async (
        callbackUrl: string,
        loginTransaction: LoginTransaction,
      ): Promise<Readonly<OidcTokenResult>> => {
        const result = await oidc.exchangeCallback(callbackUrl, loginTransaction);
        issuedIdToken = result.tokens.idToken;
        return result;
      },
      refresh: (tokens: SessionTokenSet) => oidc.refresh(tokens),
    });
    const verifier = createOidcTokenVerifier({
      audience: apiAudience,
      clientId,
      clockToleranceSeconds: 5,
      issuer,
      jwksCacheMaxAgeMs: 60_000,
      jwksCooldownMs: 1_000,
      jwksTimeoutMs: 5_000,
      jwksUri: `${issuer}/protocol/openid-connect/certs`,
    });
    const encryptionKey = Object.freeze({ id: "integration-key", value: randomBytes(32) });
    const service = createPcBffSessionService({
      audit: { record: () => Promise.resolve() },
      decryptionKeys: [encryptionKey],
      encryptionKey,
      indexingKey: randomBytes(32),
      loginTransactionTtlSeconds: 60,
      oidc: observingOidc,
      refreshLeaseTtlMs: 5_000,
      sessionAbsoluteTtlSeconds: 300,
      sessionIdleTtlSeconds: 120,
      store: createRedisBrowserSessionStore(connection.executor),
      tokenVerifier: verifier,
    });

    const login = await service.beginLogin("/tasks");
    const callback = await browser.login(login.authorizationUrl, username, password);
    const completed = await service.completeLogin(callback);
    expect(issuedIdToken).toBeDefined();
    await expect(verifier.verify(issuedIdToken ?? "")).rejects.toMatchObject({ code: "token_invalid" });
    const principal = await service.resolvePrincipal(completed.credential);
    expect(principal.clientId).toBe(clientId);
    expect(principal.authenticationSubject.issuer).toBe(issuer);
    expect(principal.authenticationSubject.subject).toBe(syntheticUserId);

    const refreshed = await service.refresh(completed.credential);
    await expect(service.currentSession(completed.credential)).rejects.toMatchObject({
      code: "authentication_session_invalid",
    });
    await expect(service.resolvePrincipal(refreshed.credential)).resolves.toMatchObject({ clientId });

    const transport = createPcAuthenticationHttpAdapter({
      allowedOrigins: ["http://127.0.0.1:8088"],
      cookieMaxAgeSeconds: 120,
      service,
    });
    const logout = await transport.logout({
      cookie: `__Host-ai_crm_pc_session=${refreshed.credential}`,
      csrfToken: refreshed.session.csrfToken,
      origin: "http://127.0.0.1:8088",
      referer: undefined,
    });
    expect(logout.status).toBe(302);
    expect(logout.headers["Set-Cookie"]).toContain("Max-Age=0");
    expect(logout.headers["Location"]).not.toContain("id_token_hint");
    const logoutLocation = logout.headers["Location"];
    if (!logoutLocation) throw new Error("Keycloak logout redirect was unavailable.");
    const logoutResponse = await browser.request(logoutLocation);
    expect(logoutResponse.status).toBeLessThan(500);
    await expect(service.currentSession(refreshed.credential)).rejects.toMatchObject({
      code: "authentication_session_invalid",
    });
    await expect(service.logout(refreshed.credential)).resolves.toEqual({});
  }, 30_000);
});
