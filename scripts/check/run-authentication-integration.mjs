import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const keycloakPort = validPort(process.env.AI_CRM_TEST_KEYCLOAK_PORT ?? "18080", "Keycloak");
const redisPort = validPort(process.env.AI_CRM_TEST_REDIS_PORT ?? "16379", "Redis");
const secretDirectory = await mkdtemp(resolve(tmpdir(), "ai-crm-iam01-auth-"));
const project = `ai-crm-test-iam01-${randomUUID().slice(0, 8)}`;
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("pnpm CLI path is unavailable.");

const environment = {
  ...process.env,
  AI_CRM_COMPOSE_SECRET_DIR: secretDirectory,
  AI_CRM_KEYCLOAK_BOOTSTRAP_ADMIN_SECRET_FILE: resolve(secretDirectory, "keycloak_bootstrap_password"),
  AI_CRM_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: "dev_admin",
  AI_CRM_KEYCLOAK_ADMIN_TIMEOUT_SECONDS: "5",
  AI_CRM_KEYCLOAK_ISSUER: `http://127.0.0.1:${String(keycloakPort)}/realms/ai-crm-dev`,
  AI_CRM_PC_OIDC_CLIENT_ID: "ai-crm-pc-bff",
  AI_CRM_PC_OIDC_CLIENT_SECRET_FILE: resolve(secretDirectory, "pc_oidc_client_secret"),
  AI_CRM_TEST_KEYCLOAK_PORT: String(keycloakPort),
  AI_CRM_TEST_REDIS_PORT: String(redisPort),
  TEST_AUTH_KEYCLOAK_ADMIN_SECRET_FILE: resolve(secretDirectory, "keycloak_bootstrap_password"),
  TEST_AUTH_KEYCLOAK_CLIENT_SECRET_FILE: resolve(secretDirectory, "pc_oidc_client_secret"),
  TEST_AUTH_KEYCLOAK_ISSUER: `http://127.0.0.1:${String(keycloakPort)}/realms/ai-crm-dev`,
  TEST_AUTH_REDIS_PASSWORD_FILE: resolve(secretDirectory, "redis_password"),
  TEST_AUTH_REDIS_URL: `redis://127.0.0.1:${String(redisPort)}`,
};

function validPort(value, service) {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    throw new Error(`${service} integration test port is invalid.`);
  }
  return port;
}

async function assertPortAvailable(port, service) {
  await new Promise((resolveAvailable, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`${service} integration test port ${String(port)} is unavailable.`)));
    server.listen(port, "127.0.0.1", () => server.close(resolveAvailable));
  });
}

function run(command, args) {
  const result = spawnSync(command, args, { env: environment, shell: false, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args[0] ?? ""} failed.`);
}

const compose = [
  "compose", "-p", project,
  "-f", "deploy/compose/compose.base.yml",
  "-f", "deploy/compose/compose.auth-test.yml",
];

const failures = [];
try {
  await assertPortAvailable(keycloakPort, "Keycloak");
  await assertPortAvailable(redisPort, "Redis");
  run(process.execPath, ["scripts/bootstrap/compose-secrets.mjs", "test"]);
  run("docker", [...compose, "up", "-d", "--wait", "postgres", "redis", "keycloak"]);
  run(process.execPath, ["scripts/bootstrap/rotate-keycloak-client-secret.mjs"]);
  run(process.execPath, [pnpmCli, "--filter", "@ai-crm/api", "test"]);
} catch (error) {
  failures.push(error);
}

const cleanup = spawnSync("docker", [...compose, "down", "--volumes", "--remove-orphans"], {
  env: environment,
  shell: false,
  stdio: "inherit",
});
if (cleanup.status !== 0) {
  failures.push(new Error(
    `Authentication integration Compose cleanup failed; Secret files were retained at ${secretDirectory}.`,
  ));
} else {
  try {
    await rm(secretDirectory, { force: true, recursive: true });
  } catch (error) {
    failures.push(new Error("Authentication integration Secret cleanup failed.", { cause: error }));
  }
}

if (failures.length > 0) {
  throw new AggregateError(failures, "Authentication integration test or cleanup failed.");
}
