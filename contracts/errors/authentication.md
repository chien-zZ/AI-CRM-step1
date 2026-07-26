# Authentication Errors

Authentication errors expose only a stable category and a bounded, user-safe message. They never include a Token, Cookie, authorization code, session handle, provider response, or internal exception text.

| Code | HTTP | Retry | Meaning |
|---|---:|---|---|
| `authentication_required` | 401 | After a new login | The local session is absent, expired, revoked, audience-mismatched, or cannot be validated. |
| `authentication_callback_invalid` | 400 | Start a new login | The one-time OIDC callback transaction failed state, nonce, PKCE, expiry, allowlist, or replay validation. |
| `authentication_csrf_rejected` | 403 | No blind retry | The modifying Cookie request failed trusted-origin or CSRF-token validation. |
| `authentication_refresh_in_progress` | 409 | Retry only after bounded backoff or session re-read | Another request owns the short-lived refresh lease; the same Refresh Token must not be used concurrently. |
| `authentication_dependency_unavailable` | 503 | According to caller retry policy | Keycloak, JWKS, session storage, decryption, or another required authentication dependency is unavailable; access fails closed. |

Business authorization denial is owned by the authorization module and must not be represented as an authentication error.
