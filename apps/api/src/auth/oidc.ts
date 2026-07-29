import {
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  buildEndSessionUrl,
  calculatePKCECodeChallenge,
  ClientSecretBasic,
  customFetch,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  refreshTokenGrant,
  type Configuration,
  type CustomFetch,
} from "openid-client";

import { BrowserSessionFailure } from "./errors.js";
import type { SessionTokenSet } from "./session-security.js";

export interface OidcClientConfiguration {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly issuer: string;
  readonly redirectUri: string;
  readonly signal?: AbortSignal;
  readonly timeoutSeconds: number;
}

export interface LoginTransaction {
  readonly codeVerifier: string;
  readonly nonce: string;
  readonly returnTo: string;
  readonly state: string;
}

export interface BeginLoginResult {
  readonly authorizationUrl: string;
  readonly transaction: Readonly<LoginTransaction>;
}

export interface OidcTokenResult {
  readonly authenticatedAtMs: number;
  readonly expiresInSeconds: number;
  readonly tokens: Readonly<SessionTokenSet>;
}

export interface OidcClientPort {
  beginLogin(returnTo: string): Promise<Readonly<BeginLoginResult>>;
  exchangeCallback(callbackUrl: string, transaction: LoginTransaction): Promise<Readonly<OidcTokenResult>>;
  refresh(tokens: SessionTokenSet): Promise<Readonly<OidcTokenResult>>;
  endSessionUrl(): string | undefined;
}

const MAX_TOKEN_LENGTH = 16_384;

function allowInsecureLoopback(issuer: URL): ((configuration: Configuration) => void)[] | undefined {
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(issuer.hostname);
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- Keycloak Compose is loopback-only HTTP in local/test environments.
  return issuer.protocol === "http:" && loopback ? [allowInsecureRequests] : undefined;
}

function validateReturnTo(value: string): string {
  if (value.length === 0 || value.length > 512 || !value.startsWith("/") || value.startsWith("//") ||
    /[\0\r\n\\]/u.test(value)) {
    throw new BrowserSessionFailure("authentication_callback_invalid");
  }
  return value;
}

function validToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TOKEN_LENGTH;
}

function normalizeTokenResult(
  response: Readonly<Record<string, unknown>>,
  previous: SessionTokenSet | undefined,
): Readonly<OidcTokenResult> {
  const accessToken = response["access_token"];
  const refreshToken = response["refresh_token"] ?? previous?.refreshToken;
  const idToken = response["id_token"] ?? previous?.idToken;
  const expiresIn = response["expires_in"];
  if (!validToken(accessToken) || !validToken(refreshToken) ||
    (idToken !== undefined && !validToken(idToken)) ||
    typeof expiresIn !== "number" || !Number.isSafeInteger(expiresIn) || expiresIn <= 0) {
    throw new BrowserSessionFailure("authentication_dependency_unavailable");
  }
  const claimsFunction = response["claims"];
  const claims: unknown = typeof claimsFunction === "function" ? claimsFunction.call(response) : undefined;
  const issuedAt = claims && typeof claims === "object" && "auth_time" in claims
    ? claims.auth_time
    : claims && typeof claims === "object" && "iat" in claims
      ? claims.iat
      : undefined;
  const authenticatedAtMs = typeof issuedAt === "number" && Number.isSafeInteger(issuedAt)
    ? issuedAt * 1000
    : Date.now();
  return Object.freeze({
    authenticatedAtMs,
    expiresInSeconds: expiresIn,
    tokens: Object.freeze(idToken === undefined
      ? { accessToken, refreshToken }
      : { accessToken, idToken, refreshToken }),
  });
}

function dependencyFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 4 && current !== undefined && !seen.has(current); depth += 1) {
    seen.add(current);
    if (current instanceof TypeError ||
      (current instanceof BrowserSessionFailure && current.code === "authentication_dependency_unavailable")) {
      return true;
    }
    if (!current || typeof current !== "object") return false;
    if ("status" in current && typeof current.status === "number" &&
      (current.status === 429 || current.status >= 500)) {
      return true;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

function callbackFailure(error: unknown): BrowserSessionFailure {
  if (dependencyFailure(error)) {
    return new BrowserSessionFailure("authentication_dependency_unavailable");
  }
  return error instanceof BrowserSessionFailure
    ? error
    : new BrowserSessionFailure(error instanceof TypeError
      ? "authentication_dependency_unavailable"
      : "authentication_callback_invalid");
}

function refreshFailure(error: unknown): BrowserSessionFailure {
  if (dependencyFailure(error)) {
    return new BrowserSessionFailure("authentication_dependency_unavailable");
  }
  return error instanceof BrowserSessionFailure
    ? error
    : new BrowserSessionFailure(error instanceof TypeError
      ? "authentication_dependency_unavailable"
      : "authentication_refresh_rejected");
}

export async function createOidcClient(
  input: OidcClientConfiguration,
): Promise<Readonly<OidcClientPort>> {
  const issuer = new URL(input.issuer);
  const redirectUri = new URL(input.redirectUri);
  const guardedFetch: CustomFetch = async (url, options): Promise<Response> => {
    const signal = input.signal === undefined
      ? options.signal
      : options.signal === undefined
        ? input.signal
        : AbortSignal.any([options.signal, input.signal]);
    const requestOptions = {
      headers: options.headers,
      method: options.method,
      redirect: options.redirect,
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(signal === undefined ? {} : { signal }),
    } satisfies RequestInit;
    const response = await fetch(url, requestOptions);
    if (response.status === 429 || response.status >= 500) {
      throw new BrowserSessionFailure("authentication_dependency_unavailable");
    }
    return response;
  };
  let configuration: Configuration;
  try {
    if (input.signal?.aborted) throw new BrowserSessionFailure("authentication_dependency_unavailable");
    const insecureExecution = allowInsecureLoopback(issuer);
    configuration = await discovery(
      issuer,
      input.clientId,
      { redirect_uris: [input.redirectUri], response_types: ["code"] },
      ClientSecretBasic(input.clientSecret),
      insecureExecution === undefined
        ? { [customFetch]: guardedFetch, timeout: input.timeoutSeconds }
        : { [customFetch]: guardedFetch, execute: insecureExecution, timeout: input.timeoutSeconds },
    );
  } catch {
    throw new BrowserSessionFailure("authentication_dependency_unavailable");
  }

  return Object.freeze({
    async beginLogin(returnTo: string): Promise<Readonly<BeginLoginResult>> {
      const codeVerifier = randomPKCECodeVerifier();
      const nonce = randomNonce();
      const state = randomState();
      const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
      const authorizationUrl = buildAuthorizationUrl(configuration, {
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        nonce,
        redirect_uri: input.redirectUri,
        response_type: "code",
        scope: "openid",
        state,
      });
      return Object.freeze({
        authorizationUrl: authorizationUrl.href,
        transaction: Object.freeze({ codeVerifier, nonce, returnTo: validateReturnTo(returnTo), state }),
      });
    },

    async exchangeCallback(callbackUrl: string, transaction: LoginTransaction): Promise<Readonly<OidcTokenResult>> {
      let currentUrl: URL;
      try {
        currentUrl = new URL(callbackUrl);
      } catch {
        throw new BrowserSessionFailure("authentication_callback_invalid");
      }
      try {
        if (currentUrl.origin !== redirectUri.origin || currentUrl.pathname !== redirectUri.pathname ||
          currentUrl.username || currentUrl.password || currentUrl.hash) {
          throw new BrowserSessionFailure("authentication_callback_invalid");
        }
        const response = await authorizationCodeGrant(configuration, currentUrl, {
          expectedNonce: transaction.nonce,
          expectedState: transaction.state,
          idTokenExpected: true,
          pkceCodeVerifier: transaction.codeVerifier,
        });
        return normalizeTokenResult(response, undefined);
      } catch (error) {
        throw callbackFailure(error);
      }
    },

    async refresh(tokens: SessionTokenSet): Promise<Readonly<OidcTokenResult>> {
      try {
        const response = await refreshTokenGrant(configuration, tokens.refreshToken);
        return normalizeTokenResult(response, tokens);
      } catch (error) {
        throw refreshFailure(error);
      }
    },

    endSessionUrl(): string | undefined {
      try {
        return buildEndSessionUrl(configuration).href;
      } catch {
        return undefined;
      }
    },
  });
}
