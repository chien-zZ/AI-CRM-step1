import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const runners = [
  "packages/platform-modules/authorization/scripts/run-postgres-integration.mjs",
  "packages/platform-modules/app-registry/scripts/run-integration.mjs",
  "packages/platform-modules/audit/scripts/run-integration.mjs",
  "packages/platform-modules/business-configuration/scripts/run-integration.mjs",
  "packages/platform-modules/eventing-outbox/scripts/run-integration.mjs",
  "packages/platform-modules/file-center/scripts/run-integration.mjs",
  "packages/platform-modules/form-schema/scripts/run-integration.mjs",
  "packages/platform-modules/notifications/scripts/run-integration.mjs",
  "packages/platform-modules/organization/scripts/run-integration.mjs",
  "packages/platform-modules/task-center/scripts/run-integration.mjs",
];

test("PostgreSQL integration runners use bounded stable TCP readiness", async () => {
  for (const path of runners) {
    const source = await readFile(resolve(root, path), "utf8");
    const compact = source.replaceAll(/\s/gu, "");
    assert.match(compact, /"--host","127\.0\.0\.1"/u, `${path} must probe PostgreSQL over TCP.`);
    assert.match(compact, /constdeadline=Date\.now\(\)\+30_000;/u, `${path} must use a wall-clock deadline.`);
    assert.match(compact, /while\(Date\.now\(\)<deadline\)/u, `${path} must enforce the wall-clock deadline.`);
    assert.match(compact, /timeout:2_000/u, `${path} must bound every readiness subprocess.`);
    assert.doesNotMatch(compact, /attempt<60/u, `${path} must not use attempt count as its overall timeout.`);
    if (path.includes("notifications")) {
      assert.match(compact, /consecutiveReady>=2/u, `${path} must require consecutive TCP readiness.`);
    } else {
      assert.match(compact, /pg_postmaster_start_time/u, `${path} must identify the postmaster generation.`);
      assert.match(compact, /currentStart===previousStart/u, `${path} must require a stable postmaster generation.`);
    }
  }
});

test("Compose-backed PostgreSQL integration runners surface cleanup failures and retain Secret evidence", async () => {
  for (const path of [
    "packages/platform-modules/eventing-outbox/scripts/run-integration.mjs",
    "packages/platform-modules/task-center/scripts/run-integration.mjs",
  ]) {
    const source = await readFile(resolve(root, path), "utf8");
    const compact = source.replaceAll(/\s/gu, "");
    const pnpmValidation = compact.indexOf("if(!pnpmCli)thrownewError");
    const secretCreation = compact.indexOf("awaitmkdtemp(");
    assert.ok(
      pnpmValidation >= 0 && secretCreation >= 0 && pnpmValidation < secretCreation,
      `${path} must validate the pnpm execution context before creating a Secret directory.`,
    );
    assert.match(compact, /catch\(error\)\{primaryFailure=error;/u, `${path} must preserve the primary failure.`);
    assert.match(compact, /if\(composeCleanup\.error\|\|composeCleanup\.status!==0\)/u, `${path} must reject failed Compose cleanup.`);
    assert.match(compact, /\}else\{try\{awaitrm\(secretDirectory/u, `${path} must remove Secrets only after Compose cleanup succeeds.`);
    assert.match(compact, /temporarySecretdirectoryretainedat/u, `${path} must identify retained cleanup evidence.`);
    assert.match(compact, /newAggregateError\(\[primaryFailure,cleanupFailure\]/u, `${path} must report primary and cleanup failures together.`);
  }
});
