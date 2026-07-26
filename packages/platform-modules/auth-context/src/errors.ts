export type AuthenticationFailureCode =
  | "identity_provider_unavailable"
  | "token_expired"
  | "token_invalid";

const safeMessages: Readonly<Record<AuthenticationFailureCode, string>> = Object.freeze({
  identity_provider_unavailable: "The authentication provider is unavailable.",
  token_expired: "The authentication token has expired.",
  token_invalid: "The authentication token is invalid.",
});

export class AuthenticationFailure extends Error {
  readonly code: AuthenticationFailureCode;

  constructor(code: AuthenticationFailureCode) {
    super(safeMessages[code]);
    this.name = "AuthenticationFailure";
    this.code = code;
  }
}
