import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fork, spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true }); });

async function waitFor(predicate: () => boolean, timeoutMs = 10_000, child?: ChildProcess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (child !== undefined && (child.exitCode !== null || child.signalCode !== null)) throw new Error("child_exited_before_condition");
    if (Date.now() >= deadline) throw new Error("child_condition_timeout");
    await new Promise<void>((resolveWait) => { setTimeout(resolveWait, 20); });
  }
}

async function waitForExit(child: ChildProcess, timeoutMs = 20_000): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      child.kill();
      rejectExit(new Error("child_exit_timeout"));
    }, timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); rejectExit(error); });
    child.once("exit", (code, signal) => { clearTimeout(timer); resolveExit({ code, signal }); });
  });
}

async function waitForMessage(child: ChildProcess, expected: string, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolveMessage, rejectMessage) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      child.off("error", onError);
      child.off("exit", onExit);
      child.off("message", onMessage);
    };
    const onError = (error: Error): void => { cleanup(); rejectMessage(error); };
    const onExit = (): void => { cleanup(); rejectMessage(new Error("child_exited_before_message")); };
    const onMessage = (message: unknown): void => {
      if (message !== expected) return;
      cleanup();
      resolveMessage();
    };
    const timer = setTimeout(() => { cleanup(); rejectMessage(new Error("child_message_timeout")); }, timeoutMs);
    child.once("error", onError);
    child.once("exit", onExit);
    child.on("message", onMessage);
  });
}

async function runNode(script: string, env: NodeJS.ProcessEnv): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
  const child = spawn(process.execPath, [resolve(script)], { env, stdio: "ignore" });
  return waitForExit(child);
}

async function signalChild(mode: "startup" | "steady" | "stuck", signal: "SIGINT" | "SIGTERM"): Promise<{ readonly code: number | null; readonly markerExists: boolean }> {
  const directory = mkdtempSync(join(tmpdir(), "ai-crm-worker-signal-"));
  directories.push(directory);
  const healthFile = join(directory, "ready.json");
  const child = fork(resolve("test-fixtures/signal-worker.mjs"), [], {
    env: { ...process.env, AI_CRM_TEST_HEALTH_FILE: healthFile, AI_CRM_TEST_SIGNAL_MODE: mode },
    silent: true,
  });
  if (mode === "startup") await waitForMessage(child, "startup-waiting");
  else await waitFor(() => existsSync(healthFile), 10_000, child);
  const exited = waitForExit(child);
  if (process.platform === "win32") child.send(signal);
  else child.kill(signal);
  const result = await exited;
  return { code: result.code, markerExists: existsSync(healthFile) };
}

describe("Worker bootstrap child process", () => {
  it("fails the production main process while reviewed topology and client configuration are unavailable", async () => {
    await expect(runNode("dist/main.js", { ...process.env, AI_CRM_RELEASE: "test.1", NODE_ENV: "production" })).resolves.toEqual({ code: 1, signal: null });
  });

  it.each(["resolve", "reject"])("returns a non-zero process exit after a ready handler %ss", async (outcome) => {
    await expect(runNode("test-fixtures/fatal-worker.mjs", { ...process.env, AI_CRM_TEST_HANDLER_OUTCOME: outcome })).resolves.toEqual({ code: 1, signal: null });
  });

  it.each(["SIGTERM", "SIGINT"] as const)("gracefully drains a ready child on %s", async (signal) => {
    await expect(signalChild("steady", signal)).resolves.toEqual({ code: 0, markerExists: false });
  });

  it("cancels startup on SIGTERM without publishing readiness", async () => {
    await expect(signalChild("startup", "SIGTERM")).resolves.toEqual({ code: 0, markerExists: false });
  });

  it("removes readiness and exits non-zero when signal drain times out", async () => {
    await expect(signalChild("stuck", "SIGTERM")).resolves.toEqual({ code: 1, markerExists: false });
  });
});
