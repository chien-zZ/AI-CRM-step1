import { randomBytes, randomUUID } from "node:crypto";
import { chmod, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL, URL, URLSearchParams } from "node:url";

/* global AbortSignal, fetch */

const defaultFileSystem = Object.freeze({ chmod, open, readFile, rename, rm });

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function rotationConfiguration(env) {
  const issuer = new URL(required(env, "AI_CRM_KEYCLOAK_ISSUER"));
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(issuer.hostname);
  if (issuer.username || issuer.password || issuer.search || issuer.hash ||
    (issuer.protocol !== "https:" && !(loopback && issuer.protocol === "http:"))) {
    throw new Error("AI_CRM_KEYCLOAK_ISSUER is not a safe Keycloak issuer URL.");
  }
  const realmMatch = /^\/realms\/([^/]+)\/?$/u.exec(issuer.pathname);
  if (!realmMatch) throw new Error("AI_CRM_KEYCLOAK_ISSUER must identify one realm.");
  const timeoutSeconds = Number(required(env, "AI_CRM_KEYCLOAK_ADMIN_TIMEOUT_SECONDS"));
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 60) {
    throw new Error("AI_CRM_KEYCLOAK_ADMIN_TIMEOUT_SECONDS must be an integer from 1 to 60.");
  }
  return Object.freeze({
    adminSecretFile: resolve(required(env, "AI_CRM_KEYCLOAK_BOOTSTRAP_ADMIN_SECRET_FILE")),
    adminUsername: required(env, "AI_CRM_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME"),
    clientId: required(env, "AI_CRM_PC_OIDC_CLIENT_ID"),
    clientSecretFile: resolve(required(env, "AI_CRM_PC_OIDC_CLIENT_SECRET_FILE")),
    issuer,
    realm: decodeURIComponent(realmMatch[1]),
    timeoutMs: timeoutSeconds * 1000,
  });
}

export async function rotateKeycloakClientSecret(options = {}) {
  const env = options.env ?? process.env;
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const nextSecret = options.nextSecret ?? randomBytes(32).toString("base64url");
  const config = rotationConfiguration(env);
  const secretPattern = /^[A-Za-z0-9_-]{43}$/u;
  if (!secretPattern.test(nextSecret)) throw new Error("The generated Keycloak Client Secret is invalid.");

  const currentSecret = (await fileSystem.readFile(config.clientSecretFile, "utf8")).trim();
  const adminPassword = (await fileSystem.readFile(config.adminSecretFile, "utf8")).trim();
  if (!secretPattern.test(currentSecret) || !adminPassword) {
    throw new Error("A Keycloak rotation Secret file is empty or invalid.");
  }

  const request = (url, init = {}) => fetchImplementation(url, {
    ...init,
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const tokenResponse = await request(new URL("/realms/master/protocol/openid-connect/token", config.issuer), {
    body: new URLSearchParams({
      client_id: "admin-cli",
      grant_type: "password",
      password: adminPassword,
      username: config.adminUsername,
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  if (!tokenResponse.ok) throw new Error("Keycloak rotation administration authentication failed.");
  const tokenPayload = await tokenResponse.json();
  const accessToken = tokenPayload && typeof tokenPayload === "object" &&
    "access_token" in tokenPayload && typeof tokenPayload.access_token === "string"
    ? tokenPayload.access_token
    : undefined;
  if (!accessToken) throw new Error("Keycloak rotation administration returned an invalid response.");

  const clientsUrl = new URL(`/admin/realms/${encodeURIComponent(config.realm)}/clients`, config.issuer);
  clientsUrl.searchParams.set("clientId", config.clientId);
  const clientsResponse = await request(clientsUrl, { headers: { authorization: `Bearer ${accessToken}` } });
  const clients = clientsResponse.ok ? await clientsResponse.json() : undefined;
  const clientSummary = Array.isArray(clients) && clients.length === 1 && clients[0] && typeof clients[0] === "object"
    ? clients[0]
    : undefined;
  if (!clientSummary || typeof clientSummary.id !== "string" || clientSummary.clientId !== config.clientId) {
    throw new Error("The configured Keycloak Client was not uniquely available for rotation.");
  }

  const clientUrl = new URL(
    `/admin/realms/${encodeURIComponent(config.realm)}/clients/${encodeURIComponent(clientSummary.id)}`,
    config.issuer,
  );
  const clientResponse = await request(clientUrl, { headers: { authorization: `Bearer ${accessToken}` } });
  const client = clientResponse.ok ? await clientResponse.json() : undefined;
  if (!client || typeof client !== "object" || client.id !== clientSummary.id || client.clientId !== config.clientId) {
    throw new Error("The complete Keycloak Client configuration was unavailable for rotation.");
  }

  const temporaryFile = resolve(dirname(config.clientSecretFile), `.pc_oidc_client_secret.${randomUUID()}.tmp`);
  let handle;
  let keycloakMutationAttempted = false;
  let committed = false;
  const failures = [];

  async function updateKeycloak(secret) {
    const response = await request(clientUrl, {
      body: JSON.stringify({ ...client, secret }),
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      method: "PUT",
    });
    if (!response.ok) throw new Error("Keycloak Client Secret rotation failed.");
  }

  try {
    handle = await fileSystem.open(temporaryFile, "wx", 0o600);
    await handle.writeFile(`${nextSecret}\n`);
    await handle.close();
    handle = undefined;
    await fileSystem.chmod(temporaryFile, 0o600);

    keycloakMutationAttempted = true;
    await updateKeycloak(nextSecret);
    const verifyResponse = await request(new URL(`${clientUrl.pathname}/client-secret`, config.issuer), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const verified = verifyResponse.ok ? await verifyResponse.json() : undefined;
    if (!verified || typeof verified !== "object" || verified.value !== nextSecret) {
      throw new Error("Keycloak did not confirm the rotated Client Secret.");
    }

    await fileSystem.rename(temporaryFile, config.clientSecretFile);
    committed = true;
  } catch (error) {
    failures.push(error);
    if (keycloakMutationAttempted && !committed) {
      try {
        await updateKeycloak(currentSecret);
      } catch (rollbackFailure) {
        failures.push(rollbackFailure);
      }
    }
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch (closeFailure) {
        failures.push(closeFailure);
      }
    }
    if (!committed) {
      try {
        await fileSystem.rm(temporaryFile, { force: true });
      } catch (cleanupFailure) {
        failures.push(cleanupFailure);
      }
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, "Keycloak Client Secret rotation failed and recovery was attempted.");
  }
}

const invokedPath = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  await rotateKeycloakClientSecret();
  console.log("The local/test Keycloak Client Secret was rotated and its restricted file was replaced.");
}
