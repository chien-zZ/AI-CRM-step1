import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const secretDirectory = await mkdtemp(resolve(tmpdir(), "ai-crm-compose-g1-"));
const project = `ai-crm-test-g1-compose-${randomUUID().slice(0, 8)}`;
const environment = { ...process.env, AI_CRM_COMPOSE_SECRET_DIR: secretDirectory };
const compose = [
  "compose", "-p", project,
  "-f", "deploy/compose/compose.base.yml",
  "-f", "deploy/compose/compose.test.yml",
];

function run(command, args) {
  const result = spawnSync(command, args, { env: environment, shell: false, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args[0] ?? ""} failed.`);
}

try {
  run(process.execPath, ["scripts/bootstrap/compose-secrets.mjs", "test"]);
  run("docker", [...compose, "up", "-d", "--wait"]);
} catch (error) {
  spawnSync("docker", [...compose, "ps"], { env: environment, shell: false, stdio: "inherit" });
  spawnSync("docker", [...compose, "logs", "--no-color", "--tail", "100"], {
    env: environment,
    shell: false,
    stdio: "inherit",
  });
  throw error;
} finally {
  spawnSync("docker", [...compose, "down", "--volumes", "--remove-orphans"], {
    env: environment,
    shell: false,
    stdio: "inherit",
  });
  await rm(secretDirectory, { force: true, recursive: true });
}
