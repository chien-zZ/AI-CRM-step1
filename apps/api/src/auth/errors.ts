export type BrowserSessionFailureCode =
  | "authentication_callback_invalid"
  | "authentication_csrf_rejected"
  | "authentication_dependency_unavailable"
  | "authentication_refresh_in_progress"
  | "authentication_refresh_rejected"
  | "authentication_session_invalid";

const safeMessages: Readonly<Record<BrowserSessionFailureCode, string>> = Object.freeze({
  authentication_callback_invalid: "The authentication callback is invalid or expired.",
  authentication_csrf_rejected: "The browser request failed session security validation.",
  authentication_dependency_unavailable: "A required authentication dependency is unavailable.",
  authentication_refresh_in_progress: "Another request is refreshing this authentication session.",
  authentication_refresh_rejected: "The authentication session can no longer be refreshed.",
  authentication_session_invalid: "The browser session is invalid.",
});

export class BrowserSessionFailure extends Error {
  readonly code: BrowserSessionFailureCode;

  constructor(code: BrowserSessionFailureCode) {
    super(safeMessages[code]);
    this.name = "BrowserSessionFailure";
    this.code = code;
  }
}
