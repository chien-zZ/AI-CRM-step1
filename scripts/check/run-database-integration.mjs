import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { spawnSync } from "node:child_process";

const port = Number(process.env.AI_CRM_TEST_POSTGRES_PORT ?? "55432");
if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) throw new Error("Invalid integration test port.");
const missingRolePort = Number(process.env.AI_CRM_TEST_POSTGRES_MISSING_ROLE_PORT ?? "55433");
if (!Number.isSafeInteger(missingRolePort) || missingRolePort < 1024 || missingRolePort > 65_535 || missingRolePort === port) {
  throw new Error("Invalid missing-role integration test port.");
}

async function assertPortAvailable(value) {
  await new Promise((resolveAvailable, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`Integration test port ${value} is unavailable.`)));
    server.listen(value, "127.0.0.1", () => server.close(resolveAvailable));
  });
}

const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("pnpm CLI path is unavailable.");
await Promise.all([assertPortAvailable(port), assertPortAvailable(missingRolePort)]);

const secretDirectory = await mkdtemp(resolve(tmpdir(), "ai-crm-g1-"));
const project = `ai-crm-test-g1-postgres-${randomUUID().slice(0, 8)}`;
const missingRoleContainer = `${project}-missing-role`;
const environment = {
  ...process.env,
  AI_CRM_COMPOSE_SECRET_DIR: secretDirectory,
  AI_CRM_CREATE_TEST_MIGRATION_URL: "1",
  AI_CRM_TEST_POSTGRES_PORT: String(port),
  TEST_DATABASE_ADMIN_PASSWORD_FILE: resolve(secretDirectory, "postgres_admin_password"),
  TEST_DATABASE_MIGRATION_URL_FILE: resolve(secretDirectory, "migration_url"),
  TEST_DATABASE_MISSING_ROLE_URL_FILE: resolve(secretDirectory, "missing_role_url"),
  TEST_DATABASE_RUNTIME_PASSWORD_FILE: resolve(secretDirectory, "postgres_app_password"),
  TEST_DATABASE_WORKER_RUNTIME_PASSWORD_FILE: resolve(secretDirectory, "postgres_worker_password"),
};
const commandTimeoutMs = Number(process.env.AI_CRM_DATABASE_INTEGRATION_COMMAND_TIMEOUT_MS ?? "300000");
if (!Number.isSafeInteger(commandTimeoutMs) || commandTimeoutMs < 10_000 || commandTimeoutMs > 900_000) {
  throw new Error("Invalid database integration command timeout.");
}

function run(command, args) {
  const result = spawnSync(command, args, { env: environment, shell: false, stdio: "inherit", timeout: commandTimeoutMs });
  if (result.error || result.status !== 0) {
    const reason = result.error?.code === "ETIMEDOUT" ? "timed out" : "failed";
    throw new Error(`${command} ${args[0] ?? ""} ${reason}.`);
  }
}

async function waitForPort(value) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolveConnected) => {
      const socket = createConnection({ host: "127.0.0.1", port: value });
      socket.once("connect", () => { socket.destroy(); resolveConnected(true); });
      socket.once("error", () => resolveConnected(false));
    });
    if (connected) return;
    await delay(250);
  }
  throw new Error(`PostgreSQL loopback port ${value} did not become reachable.`);
}

async function waitForContainerHealth(container) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = spawnSync(
      "docker",
      ["inspect", "--format={{.State.Health.Status}}", container],
      { encoding: "utf8", env: environment, shell: false, stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 },
    );
    const status = result.status === 0 ? result.stdout.trim() : "";
    if (status === "healthy") return;
    if (status === "unhealthy") throw new Error("Missing-role PostgreSQL container became unhealthy.");
    await delay(250);
  }
  throw new Error("Missing-role PostgreSQL container health deadline exceeded.");
}

const compose = [
  "compose", "-p", project,
  "-f", "deploy/compose/compose.base.yml",
  "-f", "deploy/compose/compose.postgres-test.yml",
];

let primaryFailure;
try {
  run(process.execPath, ["scripts/bootstrap/compose-secrets.mjs", "test"]);
  run("docker", [...compose, "up", "-d", "--wait", "postgres"]);
  run("docker", [
    "run", "--detach", "--name", missingRoleContainer,
    "--publish", `127.0.0.1:${String(missingRolePort)}:5432`,
    "--env", "POSTGRES_USER=ai_crm_migration",
    "--env", "POSTGRES_DB=ai_crm_missing_role",
    "--env", "POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password",
    "--mount", `type=bind,source=${resolve(secretDirectory, "postgres_migration_password")},target=/run/secrets/postgres_password,readonly`,
    "--health-cmd", "pg_isready -U ai_crm_migration -d ai_crm_missing_role",
    "--health-interval", "1s",
    "--health-timeout", "2s",
    "--health-retries", "20",
    "--health-start-period", "1s",
    "postgres:17.5-bookworm",
  ]);
  const migrationPassword = (await readFile(resolve(secretDirectory, "postgres_migration_password"), "utf8")).trim();
  await writeFile(
    environment.TEST_DATABASE_MISSING_ROLE_URL_FILE,
    `postgresql://ai_crm_migration:${encodeURIComponent(migrationPassword)}@127.0.0.1:${String(missingRolePort)}/ai_crm_missing_role\n`,
    { mode: 0o600 },
  );
  await Promise.all([waitForPort(port), waitForContainerHealth(missingRoleContainer)]);
  run(process.execPath, ["packages/database/scripts/wait-postgres-ready.mjs"]);
  run(process.execPath, [pnpmCli, "--filter", "@ai-crm/database", "build"]);
  run(process.execPath, [pnpmCli, "--filter", "@ai-crm/database", "test"]);
} catch (error) {
  primaryFailure = error;
}

const cleanupFailures = [];
for (const args of [
  ["rm", "--force", missingRoleContainer],
  [...compose, "down", "--volumes", "--remove-orphans"],
]) {
  const result = spawnSync("docker", args, { env: environment, shell: false, stdio: "inherit", timeout: 30_000 });
  if (result.error || result.status !== 0) cleanupFailures.push(new Error(`docker ${args[0]} cleanup failed.`));
}
try {
  await rm(secretDirectory, { force: true, recursive: true });
} catch (error) {
  cleanupFailures.push(error);
}
if (primaryFailure || cleanupFailures.length > 0) {
  throw new AggregateError([...(primaryFailure ? [primaryFailure] : []), ...cleanupFailures], "Database integration run or cleanup failed.");
}
