import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const container = `ai-crm-iam02-${randomUUID().slice(0, 8)}`;
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("pnpm CLI path is unavailable.");
const directory = await mkdtemp(join(tmpdir(), "ai-crm-iam02-"));
const passwordFile = join(directory, "postgres_password");
const urlFile = join(directory, "migration_url");
const password = randomBytes(32).toString("base64url");
const repositoryRoot = resolve(import.meta.dirname, "../../../..");

let cleanupError;
let primaryError;
try {
  await writeFile(passwordFile, `${password}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(passwordFile, 0o600);
  run("docker", [
    "run", "--detach", "--name", container, "--publish", "127.0.0.1::5432",
    "--env", "POSTGRES_USER=ai_crm_migration", "--env", "POSTGRES_DB=ai_crm_iam02",
    "--env", "POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password",
    "--mount", `type=bind,source=${resolve(passwordFile)},target=/run/secrets/postgres_password,readonly`,
    "postgres:17.5-alpine",
  ]);

  await waitForStablePostgres();

  const port = run("docker", ["port", container, "5432/tcp"], true).trim().split(":").at(-1);
  if (!port || !/^\d+$/u.test(port)) throw new Error("The IAM-02 PostgreSQL port could not be resolved.");
  await writeFile(urlFile, `postgresql://ai_crm_migration:${password}@127.0.0.1:${port}/ai_crm_iam02\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(urlFile, 0o600);
  run("docker", [
    "exec", container, "psql", "--username", "ai_crm_migration", "--dbname", "ai_crm_iam02",
    "--set", "ON_ERROR_STOP=1",
    "--command", "CREATE ROLE ai_crm_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; CREATE ROLE ai_crm_worker_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;",
  ]);
  run(process.execPath, [pnpmCli, "db:migrate"], false, {
    ...process.env,
    DATABASE_MIGRATION_URL_FILE: urlFile,
  });
  const vitest = resolve(import.meta.dirname, "../../../../node_modules/vitest/vitest.mjs");
  const result = spawnSync(process.execPath, [vitest, "run", "--config", "../../../vitest.config.ts", "src/postgres-store.integration.test.ts"], {
    cwd: resolve(import.meta.dirname, ".."),
    env: { ...process.env, TEST_ORGANIZATION_DATABASE_URL_FILE: urlFile },
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`IAM-02 integration tests failed with exit code ${String(result.status)}.`);
} catch (error) {
  primaryError = error;
} finally {
  const removed = spawnSync("docker", ["rm", "--force", container], { encoding: "utf8" });
  if (removed.status !== 0 && !removed.stderr.includes("No such container")) cleanupError = new Error("The IAM-02 PostgreSQL container could not be removed.");
  try { await rm(directory, { force: true, recursive: true }); } catch { cleanupError ??= new Error("The IAM-02 temporary Secret directory could not be removed."); }
}

if (primaryError && cleanupError) throw new AggregateError([primaryError, cleanupError], "IAM-02 integration and cleanup both failed.");
if (primaryError) throw primaryError;
if (cleanupError) throw cleanupError;

async function waitForStablePostgres() {
  const deadline = Date.now() + 30_000;
  let previousStart = "";
  while (Date.now() < deadline) {
    const probe = spawnSync("docker", [
      "exec", container, "psql", "--host", "127.0.0.1", "--username", "ai_crm_migration", "--dbname", "ai_crm_iam02",
      "--tuples-only", "--no-align", "--command", "select pg_postmaster_start_time()::text",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 });
    const currentStart = !probe.error && probe.status === 0 ? probe.stdout.trim() : "";
    if (currentStart && currentStart === previousStart) return;
    previousStart = currentStart;
    await delay(250);
  }
  throw new Error("The IAM-02 PostgreSQL container did not become ready.");
}

function run(command, arguments_, capture = false, environment = process.env) {
  const result = spawnSync(command, arguments_, { cwd: repositoryRoot, encoding: "utf8", env: environment, stdio: capture ? "pipe" : ["ignore", "ignore", "inherit"] });
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${String(result.status)}.`);
  return result.stdout ?? "";
}
