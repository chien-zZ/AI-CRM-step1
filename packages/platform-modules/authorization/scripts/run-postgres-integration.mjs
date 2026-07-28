import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const container = `ai-crm-auth-persist-${randomUUID().slice(0, 8)}`;
const directory = await mkdtemp(join(tmpdir(), "ai-crm-auth-persist-"));
const passwordFile = join(directory, "postgres_password");
const urlFile = join(directory, "migration_url");
const password = randomBytes(32).toString("base64url");
let primaryError; let cleanupError;
try {
  const pnpmCli = process.env.npm_execpath; if (!pnpmCli) throw new Error("pnpm execution path is unavailable.");
  run(process.execPath, [pnpmCli, "--filter", "@ai-crm/database", "build"]);
  await writeFile(passwordFile, `${password}\n`, { encoding: "utf8", mode: 0o600 }); await chmod(passwordFile, 0o600);
  run("docker", ["run", "--detach", "--name", container, "--publish", "127.0.0.1::5432", "--env", "POSTGRES_USER=ai_crm_migration", "--env", "POSTGRES_DB=ai_crm_auth_persist", "--env", "POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password", "--mount", `type=bind,source=${resolve(passwordFile)},target=/run/secrets/postgres_password,readonly`, "postgres:17.5-alpine"]);
  for (let attempt = 0; attempt < 60; attempt += 1) { const ready = spawnSync("docker", ["exec", container, "pg_isready", "--username", "ai_crm_migration", "--dbname", "ai_crm_auth_persist"], { encoding: "utf8" }); if (ready.status === 0) break; if (attempt === 59) throw new Error("AUTH-PERSIST-01 PostgreSQL did not become ready."); await new Promise((done) => setTimeout(done, 500)); }
  const port = run("docker", ["port", container, "5432/tcp"], true).trim().split(":").at(-1); if (!port || !/^\d+$/u.test(port)) throw new Error("AUTH-PERSIST-01 PostgreSQL port is unavailable.");
  await writeFile(urlFile, `postgresql://ai_crm_migration:${password}@127.0.0.1:${port}/ai_crm_auth_persist\n`, { encoding: "utf8", mode: 0o600 }); await chmod(urlFile, 0o600);
  const outcome = spawnSync(process.execPath, [resolve(import.meta.dirname, "../../../../node_modules/vitest/vitest.mjs"), "run", "--config", "../../../vitest.config.ts", "src/postgres-persistence.integration.test.ts"], { cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, TEST_AUTHORIZATION_DATABASE_URL_FILE: urlFile }, stdio: "inherit" });
  if (outcome.status !== 0) throw new Error(`AUTH-PERSIST-01 PostgreSQL integration failed with ${String(outcome.status)}.`);
} catch (error) { primaryError = error; }
finally {
  const removed = spawnSync("docker", ["rm", "--force", container], { encoding: "utf8" }); if (removed.status !== 0 && !removed.stderr.includes("No such container")) cleanupError = new Error("AUTH-PERSIST-01 PostgreSQL cleanup failed.");
  try { await rm(directory, { force: true, recursive: true }); } catch { cleanupError ??= new Error("AUTH-PERSIST-01 temporary Secret cleanup failed."); }
}
if (primaryError && cleanupError) throw new AggregateError([primaryError, cleanupError], "AUTH-PERSIST-01 integration and cleanup failed.");
if (primaryError) throw primaryError; if (cleanupError) throw cleanupError;
function run(command, arguments_, capture = false) { const outcome = spawnSync(command, arguments_, { encoding: "utf8", stdio: capture ? "pipe" : ["ignore", "ignore", "inherit"] }); if (outcome.status !== 0) throw new Error(`${command} failed with ${String(outcome.status)}.`); return outcome.stdout ?? ""; }
