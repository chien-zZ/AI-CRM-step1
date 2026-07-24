import { mkdtemp, rm } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { spawnSync } from "node:child_process";

const port = Number(process.env.AI_CRM_TEST_POSTGRES_PORT ?? "55432");
if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) throw new Error("Invalid integration test port.");

await new Promise((resolveAvailable, reject) => {
  const server = createServer();
  server.once("error", () => reject(new Error(`Integration test port ${port} is unavailable.`)));
  server.listen(port, "127.0.0.1", () => server.close(resolveAvailable));
});

const secretDirectory = await mkdtemp(resolve(tmpdir(), "ai-crm-g1-"));
const project = "ai-crm-test-g1-postgres";
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("pnpm CLI path is unavailable.");
const environment = {
  ...process.env,
  AI_CRM_COMPOSE_SECRET_DIR: secretDirectory,
  AI_CRM_CREATE_TEST_MIGRATION_URL: "1",
  AI_CRM_TEST_POSTGRES_PORT: String(port),
  TEST_DATABASE_MIGRATION_URL_FILE: resolve(secretDirectory, "migration_url"),
};

function run(command, args) {
  const result = spawnSync(command, args, { env: environment, shell: false, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args[0] ?? ""} failed.`);
}

async function waitForPort() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolveConnected) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolveConnected(true); });
      socket.once("error", () => resolveConnected(false));
    });
    if (connected) return;
    await delay(250);
  }
  throw new Error(`PostgreSQL loopback port ${port} did not become reachable.`);
}

const compose = [
  "compose", "-p", project,
  "-f", "deploy/compose/compose.base.yml",
  "-f", "deploy/compose/compose.postgres-test.yml",
];

try {
  run(process.execPath, ["scripts/bootstrap/compose-secrets.mjs", "test"]);
  run("docker", [...compose, "up", "-d", "--wait", "postgres"]);
  await waitForPort();
  run(process.execPath, [pnpmCli, "--filter", "@ai-crm/database", "build"]);
  run(process.execPath, [pnpmCli, "--filter", "@ai-crm/database", "test"]);
} finally {
  spawnSync("docker", [...compose, "down", "--volumes", "--remove-orphans"], {
    env: environment,
    shell: false,
    stdio: "inherit",
  });
  await rm(secretDirectory, { force: true, recursive: true });
}
