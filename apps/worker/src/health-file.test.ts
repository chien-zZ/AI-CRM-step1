import { mkdtempSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createFileWorkerHealthReporter } from "./health-file.js";
import { createWorkerApplication } from "./index.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true }); });

describe("Worker file health reporter", () => {
  it("publishes an atomic bounded readiness fact and removes it on drain", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-crm-worker-health-"));
    directories.push(directory);
    const filePath = join(directory, "ready.json");
    const reporter = createFileWorkerHealthReporter(filePath, () => 1_000);
    reporter.report("ok");
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({ status: "ok", updatedAt: 1_000 });
    reporter.report("ok");
    reporter.report("unavailable");
    expect(() => readFileSync(filePath)).toThrow();
  });

  it("healthcheck accepts only a fresh exact marker", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-crm-worker-health-"));
    directories.push(directory);
    const filePath = join(directory, "ready.json");
    createFileWorkerHealthReporter(filePath).report("ok");
    const script = resolve("worker-healthcheck.mjs");
    const run = () => spawnSync(process.execPath, [script], { env: { ...process.env, AI_CRM_WORKER_HEALTH_FILE: filePath } }).status;
    expect(run()).toBe(0);
    utimesSync(filePath, new Date(0), new Date(0));
    expect(run()).toBe(0);
    createFileWorkerHealthReporter(filePath, () => 0).report("ok");
    expect(run()).toBe(1);
  });

  it("removes a marker before a failed dependency startup", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-crm-worker-health-"));
    directories.push(directory);
    const filePath = join(directory, "ready.json");
    const reporter = createFileWorkerHealthReporter(filePath);
    reporter.report("ok");
    const app = createWorkerApplication({
      dependencies: () => [{ name: "database", required: true, healthy: false }],
      healthReporter: reporter,
      logger: { log: () => undefined },
    });
    await expect(app.start()).rejects.toThrow("worker_not_ready");
    expect(() => readFileSync(filePath)).toThrow();
  });
});
