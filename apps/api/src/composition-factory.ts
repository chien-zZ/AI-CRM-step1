import { AuthorizationUnavailableError } from "@ai-crm/platform-authorization";

import { BrowserSessionFailure } from "./auth/errors.js";
import type { AuthenticationHttpResponse } from "./auth/http-adapter.js";
import type { ApiPlatformBindings } from "./composition.js";
import type { ApiRuntimeConfiguration } from "./runtime-config.js";

export interface ApiPlatformBindingFactory {
  readonly create: (configuration: Readonly<ApiRuntimeConfiguration>) => ApiPlatformBindings | Promise<ApiPlatformBindings>;
}

const unavailableAuthenticationResponse: AuthenticationHttpResponse = Object.freeze({
  body: Object.freeze({
    code: "authentication_dependency_unavailable",
    message: "Authentication is temporarily unavailable.",
  }),
  headers: Object.freeze({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }),
  status: 503,
});

function rejected<T>(): Promise<T> {
  return Promise.reject(new Error("api_synthetic_capability_unavailable"));
}

function createSyntheticBindings(): ApiPlatformBindings {
  const bindings: ApiPlatformBindings = {
    audit: { readSensitive: () => rejected(), record: () => rejected() },
    authentication: {
      beginLogin: () => Promise.resolve(unavailableAuthenticationResponse),
      completeLogin: () => Promise.resolve(unavailableAuthenticationResponse),
      currentSession: () => Promise.resolve(unavailableAuthenticationResponse),
      logout: () => Promise.resolve(unavailableAuthenticationResponse),
      refresh: () => Promise.resolve(unavailableAuthenticationResponse),
    },
    authenticationCallbackUrl: (requestPathAndQuery: string) => new URL(requestPathAndQuery, "https://api.invalid").href,
    authorization: {
      batchCheck: () => Promise.reject(new AuthorizationUnavailableError()),
      check: () => Promise.reject(new AuthorizationUnavailableError()),
      invalidatePolicyVersion: () => Promise.reject(new AuthorizationUnavailableError()),
      requireAllowed: () => Promise.reject(new AuthorizationUnavailableError()),
      resolveDataScope: () => Promise.reject(new AuthorizationUnavailableError()),
    },
    databaseCompatibility: { assertCompatible: () => undefined },
    organization: {
      closeAssignment: () => rejected(), closeEmployment: () => rejected(), closeOrganizationUnitPlacement: () => rejected(),
      closeSubjectAssociation: () => rejected(), createAssignment: () => rejected(), createEmployment: () => rejected(),
      createOrganizationUnit: () => rejected(), createOrganizationUnitPlacement: () => rejected(), createPosition: () => rejected(),
      createSubjectAssociation: () => rejected(), createWorkforcePerson: () => rejected(), resolveWorkforceContext: () => rejected(),
    },
    queries: {
      applicationRegistry: { loadRegistry: () => rejected(), resolveDeepLink: () => rejected() },
      fileCenter: { authorizeDownload: () => rejected() },
      forms: { getRelease: () => rejected(), validateSubmission: () => rejected() },
      notifications: { get: () => rejected(), list: () => rejected(), unreadCount: () => rejected() },
      tasks: { get: () => rejected(), list: () => rejected() },
    },
    readiness: () => [{ healthy: false, name: "synthetic-platform", required: true }],
    sessions: { resolvePrincipal: () => Promise.reject(new BrowserSessionFailure("authentication_dependency_unavailable")) },
  };
  return Object.freeze(bindings);
}

export const defaultApiPlatformBindingFactory: ApiPlatformBindingFactory = Object.freeze({
  create(configuration: Readonly<ApiRuntimeConfiguration>) {
    if (configuration.environment === "production") {
      // Production cannot be composed until reviewed PostgreSQL/Redis configuration and
      // concrete persistence factories are available at the application boundary.
      throw new Error("api_production_composition_unavailable");
    }
    return createSyntheticBindings();
  },
});
