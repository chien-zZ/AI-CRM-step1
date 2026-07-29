import assert from "node:assert/strict";
import { test } from "node:test";
import { URL } from "node:url";

/* global AbortSignal, Response */

import { rotateKeycloakClientSecret } from "../bootstrap/rotate-keycloak-client-secret.mjs";

const currentSecret = "c".repeat(43);
const nextSecret = "n".repeat(43);
const environment = Object.freeze({
  AI_CRM_KEYCLOAK_ADMIN_TIMEOUT_SECONDS: "5",
  AI_CRM_KEYCLOAK_BOOTSTRAP_ADMIN_SECRET_FILE: "D:/restricted/keycloak_admin",
  AI_CRM_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: "dev_admin",
  AI_CRM_KEYCLOAK_ISSUER: "http://127.0.0.1:18080/realms/ai-crm-dev",
  AI_CRM_PC_OIDC_CLIENT_ID: "ai-crm-pc-bff",
  AI_CRM_PC_OIDC_CLIENT_SECRET_FILE: "D:/restricted/pc_oidc_client_secret",
});

function response(body, status = 200) {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function fixture(overrides = {}) {
  const calls = [];
  let written = "";
  const fileSystem = {
    chmod: async (path, mode) => {
      calls.push(["chmod", path, mode]);
      if (overrides.chmodFailure) throw new Error("Synthetic chmod failure.");
    },
    open: async (path) => {
      calls.push(["open", path]);
      return {
        close: async () => calls.push(["close", path]),
        writeFile: async (value) => {
          written = value;
          calls.push(["write", path]);
        },
      };
    },
    readFile: async (path) => path.endsWith("keycloak_admin") ? "synthetic-admin\n" : `${currentSecret}\n`,
    rename: async (source, target) => {
      calls.push(["rename", source, target]);
      if (overrides.renameFailure) throw new Error("Synthetic rename failure.");
    },
    rm: async (path) => calls.push(["rm", path]),
  };
  const updates = [];
  const fetchImplementation = async (url, init = {}) => {
    calls.push(["fetch", String(url)]);
    assert.ok(init.signal instanceof AbortSignal);
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/token")) return response({ access_token: "synthetic-admin-token" });
    if (parsed.searchParams.has("clientId")) return response([{ clientId: "ai-crm-pc-bff", id: "client-uuid" }]);
    if (parsed.pathname.endsWith("/client-secret")) return response({ value: nextSecret });
    if (init.method === "PUT") {
      const body = JSON.parse(init.body);
      updates.push(body.secret);
      if (overrides.ambiguousUpdateFailure && body.secret === nextSecret) {
        throw new Error("Synthetic timeout after Keycloak applied the Secret.");
      }
      return response(undefined, 204);
    }
    return response({ clientId: "ai-crm-pc-bff", enabled: true, id: "client-uuid" });
  };
  return { calls, fetchImplementation, fileSystem, updates, written };
}

test("commits a verified Secret only after permissions are restricted", async () => {
  const state = fixture();
  await rotateKeycloakClientSecret({
    env: environment,
    fetchImplementation: state.fetchImplementation,
    fileSystem: state.fileSystem,
    nextSecret,
  });

  const operations = state.calls.map(([operation]) => operation);
  assert.ok(operations.indexOf("chmod") < operations.indexOf("rename"));
  assert.equal(operations.at(-1), "rename");
  assert.deepEqual(state.updates, [nextSecret]);
});

test("cleans the temporary Secret without updating Keycloak when permission restriction fails", async () => {
  const state = fixture({ chmodFailure: true });
  await assert.rejects(
    rotateKeycloakClientSecret({
      env: environment,
      fetchImplementation: state.fetchImplementation,
      fileSystem: state.fileSystem,
      nextSecret,
    }),
    /rotation failed and recovery was attempted/u,
  );

  assert.deepEqual(state.updates, []);
  assert.equal(state.calls.at(-1)?.[0], "rm");
});

test("rolls Keycloak back and removes the temporary Secret when file commit fails", async () => {
  const state = fixture({ renameFailure: true });
  await assert.rejects(
    rotateKeycloakClientSecret({
      env: environment,
      fetchImplementation: state.fetchImplementation,
      fileSystem: state.fileSystem,
      nextSecret,
    }),
    /rotation failed and recovery was attempted/u,
  );

  assert.deepEqual(state.updates, [nextSecret, currentSecret]);
  assert.equal(state.calls.at(-1)?.[0], "rm");
});

test("rolls Keycloak back when the update response is ambiguous", async () => {
  const state = fixture({ ambiguousUpdateFailure: true });
  await assert.rejects(
    rotateKeycloakClientSecret({
      env: environment,
      fetchImplementation: state.fetchImplementation,
      fileSystem: state.fileSystem,
      nextSecret,
    }),
    /rotation failed and recovery was attempted/u,
  );

  assert.deepEqual(state.updates, [nextSecret, currentSecret]);
  assert.equal(state.calls.at(-1)?.[0], "rm");
});
