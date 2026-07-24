export class AuthorizationDeniedError extends Error {
  public readonly code = "AUTHORIZATION_DENIED" as const;
  public readonly decisionId: string;

  public constructor(decisionId: string) {
    super("AUTHORIZATION_DENIED");
    this.name = "AuthorizationDeniedError";
    this.decisionId = decisionId;
  }
}

export class AuthorizationUnavailableError extends Error {
  public readonly code = "AUTHORIZATION_UNAVAILABLE" as const;

  public constructor() {
    super("AUTHORIZATION_UNAVAILABLE");
    this.name = "AuthorizationUnavailableError";
  }
}
