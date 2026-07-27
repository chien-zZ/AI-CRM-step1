import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapWorker } from "../dist/index.js";

const directory = mkdtempSync(join(tmpdir(), "ai-crm-worker-child-"));
const mode = process.env["AI_CRM_TEST_HANDLER_OUTCOME"] === "resolve" ? "resolve" : "reject";
const code = await bootstrapWorker({
  composition: {
    handlers: [{
      name: "synthetic.fatal",
      ready: () => undefined,
      run: (signal) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { if (mode === "resolve") resolve(); else reject(new Error("synthetic")); }, 25);
        signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      }),
    }],
  },
  configuration: {
    drainTimeoutMs: 1_000,
    environment: "test",
    healthFile: join(directory, "ready.json"),
    healthMaxAgeMs: 45_000,
    healthRefreshMs: 10_000,
    instanceId: "synthetic-child",
    logLevel: "error",
    release: "test.1",
    startupTimeoutMs: 1_000,
  },
  logger: { log: () => undefined },
});
process.exitCode = code;
