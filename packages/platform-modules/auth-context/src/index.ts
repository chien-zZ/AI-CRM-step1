export {
  supportedOidcAlgorithms,
  validateOidcVerifierConfig,
  type OidcVerifierConfig,
  type SupportedOidcAlgorithm,
  type ValidatedOidcVerifierConfig,
} from "./config.js";
export { AuthenticationFailure, type AuthenticationFailureCode } from "./errors.js";
export type { AuthenticatedPrincipal, AuthenticationSubject, TokenVerifier } from "./principal.js";
export { createOidcTokenVerifier } from "./verifier.js";

export const packageId = "@ai-crm/platform-auth-context" as const;
