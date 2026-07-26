export interface AuthenticationSubject {
  readonly issuer: string;
  readonly subject: string;
}

export interface AuthenticatedPrincipal {
  readonly authenticationSubject: Readonly<AuthenticationSubject>;
  readonly clientId: string;
  readonly expiresAt: string;
  readonly issuedAt: string;
}

export interface TokenVerifier {
  verify(token: string): Promise<Readonly<AuthenticatedPrincipal>>;
}
