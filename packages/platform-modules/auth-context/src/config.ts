export const supportedOidcAlgorithms = ["RS256", "PS256"] as const;

export type SupportedOidcAlgorithm = (typeof supportedOidcAlgorithms)[number];

export interface OidcVerifierConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly clientId: string;
  readonly jwksUri: string;
  readonly algorithms?: readonly SupportedOidcAlgorithm[];
  readonly clockToleranceSeconds: number;
  readonly jwksCacheMaxAgeMs: number;
  readonly jwksCooldownMs: number;
  readonly jwksTimeoutMs: number;
}

export interface ValidatedOidcVerifierConfig extends Omit<OidcVerifierConfig, "algorithms"> {
  readonly algorithms: readonly SupportedOidcAlgorithm[];
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$/u;

function parseEndpoint(value: string, name: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error(`OIDC ${name} must be an absolute URL.`);
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error(`OIDC ${name} must not contain credentials, a query, or a fragment.`);
  }
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(loopback && endpoint.protocol === "http:")) {
    throw new Error(`OIDC ${name} must use HTTPS outside a loopback development environment.`);
  }
  return endpoint;
}

function positiveInteger(value: number, name: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`OIDC ${name} must be a positive integer no greater than ${String(maximum)}.`);
  }
}

export function validateOidcVerifierConfig(config: OidcVerifierConfig): ValidatedOidcVerifierConfig {
  const issuer = parseEndpoint(config.issuer, "issuer");
  const jwksUri = parseEndpoint(config.jwksUri, "JWKS URI");
  if (!IDENTIFIER.test(config.audience)) throw new Error("OIDC audience is invalid.");
  if (!IDENTIFIER.test(config.clientId)) throw new Error("OIDC clientId is invalid.");
  positiveInteger(config.clockToleranceSeconds, "clockToleranceSeconds", 300);
  positiveInteger(config.jwksCacheMaxAgeMs, "jwksCacheMaxAgeMs", 86_400_000);
  positiveInteger(config.jwksCooldownMs, "jwksCooldownMs", 3_600_000);
  positiveInteger(config.jwksTimeoutMs, "jwksTimeoutMs", 60_000);

  const algorithms = config.algorithms ?? supportedOidcAlgorithms;
  if (algorithms.length === 0 || algorithms.some((algorithm) => !supportedOidcAlgorithms.includes(algorithm))) {
    throw new Error("OIDC algorithms contain an unsupported value.");
  }

  return Object.freeze({
    ...config,
    algorithms: Object.freeze([...new Set(algorithms)]),
    issuer: issuer.href.replace(/\/$/u, ""),
    jwksUri: jwksUri.href,
  });
}
