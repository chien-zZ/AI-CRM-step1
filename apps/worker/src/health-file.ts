import { randomUUID } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";

export type WorkerHealthStatus = "ok" | "unavailable";

export interface WorkerHealthReporter {
  report(status: WorkerHealthStatus): void;
}

export function createFileWorkerHealthReporter(filePath: string, now: () => number = Date.now): WorkerHealthReporter {
  return Object.freeze({
    report(status: WorkerHealthStatus): void {
      if (status === "unavailable") {
        rmSync(filePath, { force: true });
        return;
      }
      const temporaryPath = `${filePath}.${String(process.pid)}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporaryPath, `${JSON.stringify({ status: "ok", updatedAt: now() })}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
        renameSync(temporaryPath, filePath);
      } finally {
        rmSync(temporaryPath, { force: true });
      }
    },
  });
}
