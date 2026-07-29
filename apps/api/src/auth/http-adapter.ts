import { BrowserSessionFailure, type BrowserSessionFailureCode } from "./errors.js";
import { clearPcSessionCookie, serializePcSessionCookie, validateBrowserMutation } from "./session-security.js";
import type { BrowserSessionView, PcBffSessionService } from "./session-service.js";

export interface AuthenticationHttpResponse {
  readonly body?: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly status: number;
}

export interface BrowserRequestContext {
  readonly cookie: string | undefined;
  readonly csrfToken: string | undefined;
  readonly origin: string | undefined;
  readonly referer: string | undefined;
}

export interface PcAuthenticationHttpAdapter {
  beginLogin(returnTo: string | undefined): Promise<Readonly<AuthenticationHttpResponse>>;
  completeLogin(callbackUrl: string): Promise<Readonly<AuthenticationHttpResponse>>;
  currentSession(cookieHeader: string | undefined): Promise<Readonly<AuthenticationHttpResponse>>;
  logout(context: BrowserRequestContext): Promise<Readonly<AuthenticationHttpResponse>>;
  refresh(context: BrowserRequestContext): Promise<Readonly<AuthenticationHttpResponse>>;
}

export interface PcAuthenticationHttpAdapterOptions {
  readonly allowedOrigins: readonly string[];
  readonly cookieMaxAgeSeconds: number;
  readonly service: PcBffSessionService;
}

interface ErrorMapping {
  readonly contractCode: string;
  readonly status: number;
}

const errorMappings: Readonly<Record<BrowserSessionFailureCode, ErrorMapping>> = Object.freeze({
  authentication_callback_invalid: { contractCode: "authentication_callback_invalid", status: 400 },
  authentication_csrf_rejected: { contractCode: "authentication_csrf_rejected", status: 403 },
  authentication_dependency_unavailable: { contractCode: "authentication_dependency_unavailable", status: 503 },
  authentication_refresh_in_progress: { contractCode: "authentication_refresh_in_progress", status: 409 },
  authentication_refresh_rejected: { contractCode: "authentication_required", status: 401 },
  authentication_session_invalid: { contractCode: "authentication_required", status: 401 },
});

const safeMessages: Readonly<Record<string, string>> = Object.freeze({
  authentication_callback_invalid: "The authentication callback is invalid or expired.",
  authentication_csrf_rejected: "The browser request failed security validation.",
  authentication_dependency_unavailable: "Authentication is temporarily unavailable.",
  authentication_refresh_in_progress: "The authentication session is already being refreshed.",
  authentication_required: "Authentication is required.",
});

function noStoreHeaders(additional: Readonly<Record<string, string>> = {}): Readonly<Record<string, string>> {
  return Object.freeze({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    ...additional,
  });
}

function errorResponse(error: unknown): Readonly<AuthenticationHttpResponse> {
  const mapping = error instanceof BrowserSessionFailure
    ? errorMappings[error.code]
    : errorMappings.authentication_dependency_unavailable;
  return Object.freeze({
    body: Object.freeze({
      code: mapping.contractCode,
      message: safeMessages[mapping.contractCode] ?? "Authentication failed.",
    }),
    headers: noStoreHeaders(),
    status: mapping.status,
  });
}

function sessionBody(session: BrowserSessionView): Readonly<Record<string, unknown>> {
  return Object.freeze({
    authenticatedAt: session.authenticatedAt,
    client: session.client,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  });
}

export function parsePcSessionCredential(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined) return undefined;
  if (cookieHeader.length > 4096 || /[\0\r\n]/u.test(cookieHeader)) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  const values = cookieHeader.split(";").map((part) => part.trim()).flatMap((part) => {
    const separator = part.indexOf("=");
    return separator < 0 || part.slice(0, separator) !== "__Host-ai_crm_pc_session"
      ? []
      : [part.slice(separator + 1)];
  });
  if (values.length === 0) return undefined;
  if (values.length !== 1 || !/^[A-Za-z0-9_-]{43}$/u.test(values[0] ?? "")) {
    throw new BrowserSessionFailure("authentication_session_invalid");
  }
  return values[0];
}

function requiredCredential(cookieHeader: string | undefined): string {
  const credential = parsePcSessionCredential(cookieHeader);
  if (credential === undefined) throw new BrowserSessionFailure("authentication_session_invalid");
  return credential;
}

export function createPcAuthenticationHttpAdapter(
  options: PcAuthenticationHttpAdapterOptions,
): Readonly<PcAuthenticationHttpAdapter> {
  return Object.freeze({
    async beginLogin(returnTo: string | undefined): Promise<Readonly<AuthenticationHttpResponse>> {
      try {
        const result = await options.service.beginLogin(returnTo ?? "/");
        return Object.freeze({ headers: noStoreHeaders({ Location: result.authorizationUrl }), status: 302 });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async completeLogin(callbackUrl: string): Promise<Readonly<AuthenticationHttpResponse>> {
      try {
        const result = await options.service.completeLogin(callbackUrl);
        return Object.freeze({
          headers: noStoreHeaders({
            Location: result.returnTo,
            "Set-Cookie": serializePcSessionCookie(result.credential, options.cookieMaxAgeSeconds),
          }),
          status: 302,
        });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async currentSession(cookieHeader: string | undefined): Promise<Readonly<AuthenticationHttpResponse>> {
      try {
        const session = await options.service.currentSession(requiredCredential(cookieHeader));
        return Object.freeze({ body: sessionBody(session), headers: noStoreHeaders(), status: 200 });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async logout(context: BrowserRequestContext): Promise<Readonly<AuthenticationHttpResponse>> {
      try {
        const credential = parsePcSessionCredential(context.cookie);
        if (credential !== undefined) {
          const session = await options.service.sessionForMutation(credential);
          validateBrowserMutation({
            allowedOrigins: options.allowedOrigins,
            csrfHeader: context.csrfToken,
            csrfSessionValue: session.csrfToken,
            origin: context.origin,
            referer: context.referer,
          });
          const result = await options.service.logout(credential, session.sessionReference);
          const headers = result.endSessionUrl === undefined
            ? { "Set-Cookie": clearPcSessionCookie() }
            : { Location: result.endSessionUrl, "Set-Cookie": clearPcSessionCookie() };
          return Object.freeze({
            headers: noStoreHeaders(headers),
            status: result.endSessionUrl === undefined ? 204 : 302,
          });
        }
        validateBrowserMutation({
          allowedOrigins: options.allowedOrigins,
          csrfHeader: "anonymous-logout",
          csrfSessionValue: "anonymous-logout",
          origin: context.origin,
          referer: context.referer,
        });
        return Object.freeze({
          headers: noStoreHeaders({ "Set-Cookie": clearPcSessionCookie() }),
          status: 204,
        });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async refresh(context: BrowserRequestContext): Promise<Readonly<AuthenticationHttpResponse>> {
      try {
        const credential = requiredCredential(context.cookie);
        const session = await options.service.sessionForMutation(credential);
        validateBrowserMutation({
          allowedOrigins: options.allowedOrigins,
          csrfHeader: context.csrfToken,
          csrfSessionValue: session.csrfToken,
          origin: context.origin,
          referer: context.referer,
        });
        const refreshed = await options.service.refresh(credential);
        return Object.freeze({
          headers: noStoreHeaders({
            "Set-Cookie": serializePcSessionCookie(refreshed.credential, options.cookieMaxAgeSeconds),
          }),
          status: 204,
        });
      } catch (error) {
        return errorResponse(error);
      }
    },
  });
}
