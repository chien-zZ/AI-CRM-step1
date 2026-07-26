import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from "jose";

import { validateOidcVerifierConfig, type OidcVerifierConfig } from "./config.js";
import { AuthenticationFailure } from "./errors.js";
import type { AuthenticatedPrincipal, TokenVerifier } from "./principal.js";

const MAX_TOKEN_LENGTH = 16_384;
const MAX_SUBJECT_LENGTH = 255;

function numericDate(value: number): string {
  return new Date(value * 1000).toISOString();
}

function normalizePrincipal(
  payload: JWTPayload,
  clientId: string,
  clockToleranceSeconds: number,
): Readonly<AuthenticatedPrincipal> {
  if (
    typeof payload.iss !== "string"
    || typeof payload.sub !== "string"
    || payload.sub.length === 0
    || payload.sub.length > MAX_SUBJECT_LENGTH
    || typeof payload.iat !== "number"
    || typeof payload.exp !== "number"
  ) {
    throw new AuthenticationFailure("token_invalid");
  }
  if (payload.azp !== clientId) {
    throw new AuthenticationFailure("token_invalid");
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.iat > payload.exp || payload.iat > now + clockToleranceSeconds) {
    throw new AuthenticationFailure("token_invalid");
  }

  return Object.freeze({
    authenticationSubject: Object.freeze({ issuer: payload.iss, subject: payload.sub }),
    clientId,
    expiresAt: numericDate(payload.exp),
    issuedAt: numericDate(payload.iat),
  });
}

function normalizeFailure(error: unknown): AuthenticationFailure {
  if (error instanceof AuthenticationFailure) return error;
  if (error instanceof errors.JWTExpired) return new AuthenticationFailure("token_expired");
  if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) {
    return new AuthenticationFailure("identity_provider_unavailable");
  }
  if (error instanceof errors.JOSEError) return new AuthenticationFailure("token_invalid");
  return new AuthenticationFailure("identity_provider_unavailable");
}

export function createOidcTokenVerifier(input: OidcVerifierConfig): TokenVerifier {
  const config = validateOidcVerifierConfig(input);
  const keySet = createRemoteJWKSet(new URL(config.jwksUri), {
    cacheMaxAge: config.jwksCacheMaxAgeMs,
    cooldownDuration: config.jwksCooldownMs,
    timeoutDuration: config.jwksTimeoutMs,
  });

  return Object.freeze({
    async verify(token: string): Promise<Readonly<AuthenticatedPrincipal>> {
      if (!token || token.length > MAX_TOKEN_LENGTH) throw new AuthenticationFailure("token_invalid");
      try {
        const result = await jwtVerify(token, keySet, {
          algorithms: [...config.algorithms],
          audience: config.audience,
          clockTolerance: config.clockToleranceSeconds,
          issuer: config.issuer,
          requiredClaims: ["iss", "sub", "aud", "exp", "iat"],
        });
        return normalizePrincipal(result.payload, config.clientId, config.clockToleranceSeconds);
      } catch (error) {
        throw normalizeFailure(error);
      }
    },
  });
}
