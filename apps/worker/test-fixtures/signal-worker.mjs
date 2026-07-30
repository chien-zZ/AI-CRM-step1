import { bootstrapWorker } from "../dist/index.js";

const mode = process.env["AI_CRM_TEST_SIGNAL_MODE"] ?? "steady";
const healthFile = process.env["AI_CRM_TEST_HEALTH_FILE"];
if (!healthFile) throw new Error("AI_CRM_TEST_HEALTH_FILE required");

process.on("message", (message) => {
  if (message === "SIGTERM" || message === "SIGINT") process.emit(message);
});

const waitForAbort = (signal) => new Promise((resolve) => {
  if (signal.aborted) resolve();
  else signal.addEventListener("abort", resolve, { once: true });
});

const waitForStartupAbort = (signal) => {
  if (process.connected) process.send("startup-waiting");
  return waitForAbort(signal);
};

const code = await bootstrapWorker({
  composition: {
    handlers: [{
      name: "synthetic.signal",
      ready: mode === "startup" ? waitForStartupAbort : () => undefined,
      run: mode === "stuck" ? () => new Promise(() => undefined) : waitForAbort,
    }],
  },
  configuration: {
    drainTimeoutMs: 100,
    environment: "test",
    healthFile,
    healthMaxAgeMs: 5_000,
    healthRefreshMs: 1_000,
    instanceId: "synthetic-signal-child",
    logLevel: "error",
    release: "test.1",
    startupTimeoutMs: 1_000,
  },
  logger: { log: () => undefined },
});
if (process.connected) process.disconnect();
process.exitCode = code;
