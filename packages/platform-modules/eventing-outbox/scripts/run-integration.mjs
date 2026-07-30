import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const port = Number(process.env.AI_CRM_TEST_EVENTING_POSTGRES_PORT ?? "55433");
if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) throw new Error("Invalid Eventing integration test port.");
await new Promise((ready, reject) => {
  const server = createServer();
  server.once("error", () => reject(new Error(`Integration test port ${port} is unavailable.`)));
  server.listen(port, "127.0.0.1", () => server.close(ready));
});

const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("pnpm CLI path is unavailable.");
const secretDirectory = await mkdtemp(resolve(tmpdir(), "ai-crm-asy01-"));
const project = `ai-crm-test-asy01-${randomUUID().slice(0, 8)}`;
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const environment = {
  ...process.env,
  AI_CRM_COMPOSE_SECRET_DIR: secretDirectory,
  AI_CRM_CREATE_TEST_MIGRATION_URL: "1",
  AI_CRM_TEST_POSTGRES_PORT: String(port),
  DATABASE_MIGRATION_URL_FILE: resolve(secretDirectory, "migration_url"),
  TEST_EVENTING_DATABASE_URL_FILE: resolve(secretDirectory, "migration_url"),
};
const compose = ["compose", "-p", project, "-f", "deploy/compose/compose.base.yml", "-f", "deploy/compose/compose.postgres-test.yml"];

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, env: environment, shell: false, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args[0] ?? ""} failed.`);
}

async function waitForStablePostgres() {
  const deadline = Date.now() + 30_000;
  let previousStart = "";
  while (Date.now() < deadline) {
    const probe = spawnSync("docker", [
      ...compose, "exec", "-T", "postgres", "sh", "-c",
      'export PGPASSWORD="$(cat /run/secrets/postgres_admin_password)"; exec "$@"',
      "sh", "psql", "--host", "127.0.0.1", "--username", "ai_crm_admin", "--dbname", "postgres",
      "--tuples-only", "--no-align", "--command", "select pg_postmaster_start_time()::text",
    ], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    });
    const currentStart = !probe.error && probe.status === 0 ? probe.stdout.trim() : "";
    if (currentStart && currentStart === previousStart) return;
    previousStart = currentStart;
    await delay(250);
  }
  throw new Error("Isolated Eventing PostgreSQL did not become stably reachable over TCP.");
}

let primaryFailure;
try {
  run(process.execPath, ["scripts/bootstrap/compose-secrets.mjs", "test"]);
  run("docker", [...compose, "up", "-d", "--wait", "postgres"]);
  await waitForStablePostgres();
  run(process.execPath, [pnpmCli, "--filter", "@ai-crm/database", "build"]);
  run(process.execPath, [pnpmCli, "db:migrate"]);
  run(process.execPath, [pnpmCli, "--filter", "@ai-crm/platform-eventing-outbox", "exec", "vitest", "run", "--config", "../../../vitest.config.ts", "src/postgres-store.integration.test.ts"]);
} catch (error) {
  primaryFailure = error;
}

let cleanupFailure;
const composeCleanup = spawnSync("docker", [...compose, "down", "--volumes", "--remove-orphans"], {
  cwd: repositoryRoot,
  env: environment,
  shell: false,
  stdio: "inherit",
});
if (composeCleanup.error || composeCleanup.status !== 0) {
  cleanupFailure = new Error(`Eventing integration Compose cleanup failed; temporary Secret directory retained at ${secretDirectory}.`);
} else {
  try {
    await rm(secretDirectory, { force: true, recursive: true });
  } catch (error) {
    cleanupFailure = new Error(`Eventing integration Secret cleanup failed; manual cleanup is required at ${secretDirectory}.`, { cause: error });
  }
}

if (primaryFailure && cleanupFailure) throw new AggregateError([primaryFailure, cleanupFailure], "Eventing integration and cleanup failed.");
if (primaryFailure) throw primaryFailure;
if (cleanupFailure) throw cleanupFailure;
