import type { AuthenticatedPrincipal } from "@ai-crm/platform-auth-context";
import { describe, expect, it } from "vitest";

import { BrowserSessionFailure } from "./errors.js";
import { createPcAuthenticationHttpAdapter, parsePcSessionCredential } from "./http-adapter.js";
import type {
  BrowserMutationSession,
  BrowserSessionView,
  CompletedLogin,
  LoginRedirect,
  LogoutResult,
  PcBffSessionService,
  RefreshedSession,
} from "./session-service.js";

const credential = "c".repeat(43);
const refreshedCredential = "r".repeat(43);
const csrfToken = "x".repeat(43);
const session: BrowserSessionView = Object.freeze({
  authenticatedAt: "2026-07-24T12:00:00.000Z",
  client: "pc-web",
  csrfToken,
  expiresAt: "2026-07-24T20:00:00.000Z",
});

class FakeSessionService implements PcBffSessionService {
  logoutCalls = 0;
  refreshFailure: BrowserSessionFailure | undefined;
  refreshCalls = 0;

  beginLogin(): Promise<Readonly<LoginRedirect>> {
    return Promise.resolve({ authorizationUrl: "https://identity.example.test/authorize" });
  }

  completeLogin(): Promise<Readonly<CompletedLogin>> {
    return Promise.resolve({ credential, returnTo: "/tasks", session });
  }

  currentSession(): Promise<Readonly<BrowserSessionView>> {
    return Promise.resolve(session);
  }

  logout(): Promise<Readonly<LogoutResult>> {
    this.logoutCalls += 1;
    return Promise.resolve({ endSessionUrl: "https://identity.example.test/logout" });
  }

  refresh(): Promise<Readonly<RefreshedSession>> {
    this.refreshCalls += 1;
    return this.refreshFailure === undefined
      ? Promise.resolve({ credential: refreshedCredential, session })
      : Promise.reject(this.refreshFailure);
  }

  resolvePrincipal(): Promise<Readonly<AuthenticatedPrincipal>> {
    return Promise.reject(new Error("Not used by the HTTP adapter test."));
  }

  sessionForMutation(): Promise<Readonly<BrowserMutationSession>> {
    return Promise.resolve({ ...session, sessionReference: "s".repeat(43) });
  }
}

function adapter(service = new FakeSessionService()) {
  return {
    adapter: createPcAuthenticationHttpAdapter({
      allowedOrigins: ["https://workbench.example.test"],
      cookieMaxAgeSeconds: 1800,
      service,
    }),
    service,
  };
}

function mutationContext(overrides: Partial<{
  cookie: string | undefined;
  csrfToken: string | undefined;
  origin: string | undefined;
  referer: string | undefined;
}> = {}) {
  return {
    cookie: `other=value; __Host-ai_crm_pc_session=${credential}`,
    csrfToken,
    origin: "https://workbench.example.test",
    referer: undefined,
    ...overrides,
  };
}

describe("createPcAuthenticationHttpAdapter", () => {
  it("maps login and callback results to no-store redirects and secure cookies", async () => {
    const transport = adapter().adapter;

    await expect(transport.beginLogin("/tasks")).resolves.toMatchObject({
      headers: { "Cache-Control": "no-store", Location: "https://identity.example.test/authorize" },
      status: 302,
    });
    const callback = await transport.completeLogin("https://workbench.example.test/auth/pc/callback?code=x&state=y");
    expect(callback.status).toBe(302);
    expect(callback.headers["Location"]).toBe("/tasks");
    expect(callback.headers["Set-Cookie"]).toContain("HttpOnly");
    expect(JSON.stringify(callback)).not.toContain("accessToken");
  });

  it("returns only the browser-safe current session view", async () => {
    const response = await adapter().adapter.currentSession(`__Host-ai_crm_pc_session=${credential}`);

    expect(response).toEqual({
      body: session,
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
      status: 200,
    });
  });

  it("validates session-bound CSRF before refresh and rotates the cookie", async () => {
    const fixture = adapter();
    const response = await fixture.adapter.refresh(mutationContext());

    expect(response.status).toBe(204);
    expect(response.headers["Set-Cookie"]).toContain(refreshedCredential);
    expect(fixture.service.refreshCalls).toBe(1);
  });

  it("rejects an untrusted origin before invoking refresh", async () => {
    const fixture = adapter();
    const response = await fixture.adapter.refresh(mutationContext({ origin: "https://attacker.example.test" }));

    expect(response).toMatchObject({
      body: { code: "authentication_csrf_rejected" },
      status: 403,
    });
    expect(fixture.service.refreshCalls).toBe(0);
  });

  it("maps refresh lease conflicts to the reviewed 409 error", async () => {
    const fixture = adapter();
    fixture.service.refreshFailure = new BrowserSessionFailure("authentication_refresh_in_progress");

    await expect(fixture.adapter.refresh(mutationContext())).resolves.toMatchObject({
      body: { code: "authentication_refresh_in_progress" },
      status: 409,
    });
  });

  it("clears an absent session idempotently without contacting the provider", async () => {
    const fixture = adapter();
    const response = await fixture.adapter.logout(mutationContext({ cookie: undefined, csrfToken: undefined }));

    expect(response.status).toBe(204);
    expect(response.headers["Set-Cookie"]).toContain("Max-Age=0");
    expect(fixture.service.logoutCalls).toBe(0);
  });

  it("does not let a cross-site request clear an absent session cookie", async () => {
    const fixture = adapter();
    const response = await fixture.adapter.logout(mutationContext({
      cookie: undefined,
      csrfToken: undefined,
      origin: "https://attacker.example.test",
    }));

    expect(response).toMatchObject({ body: { code: "authentication_csrf_rejected" }, status: 403 });
    expect(response.headers["Set-Cookie"]).toBeUndefined();
    expect(fixture.service.logoutCalls).toBe(0);
  });

  it("clears the local cookie and redirects an existing session to Keycloak logout", async () => {
    const fixture = adapter();
    const response = await fixture.adapter.logout(mutationContext());

    expect(response.status).toBe(302);
    expect(response.headers["Location"]).toBe("https://identity.example.test/logout");
    expect(response.headers["Location"]).not.toContain("id_token_hint");
    expect(response.headers["Set-Cookie"]).toContain("Max-Age=0");
    expect(fixture.service.logoutCalls).toBe(1);
  });
});

describe("parsePcSessionCredential", () => {
  it("rejects duplicate and malformed session cookies", () => {
    expect(() => parsePcSessionCredential(
      `__Host-ai_crm_pc_session=${credential}; __Host-ai_crm_pc_session=${refreshedCredential}`,
    )).toThrow("browser session is invalid");
    expect(() => parsePcSessionCredential("__Host-ai_crm_pc_session=short"))
      .toThrow("browser session is invalid");
  });
});
