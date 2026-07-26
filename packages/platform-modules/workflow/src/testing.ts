import { WorkflowError } from "./errors.js";
import type { WorkflowCommandLedger, WorkflowCommandResult, WorkflowCommandStatus, WorkflowOperation } from "./types.js";

type Entry =
  | { readonly fingerprint: string; readonly status: "running"; readonly promise: Promise<Readonly<WorkflowCommandResult<unknown>>> }
  | { readonly fingerprint: string; readonly status: "completed"; readonly result: Readonly<WorkflowCommandResult<unknown>> }
  | { readonly fingerprint: string; readonly status: "reconciliation_required"; readonly error: WorkflowError };

export const createMemoryWorkflowCommandLedger = (): WorkflowCommandLedger => {
  const entries = new Map<string, Entry>();
  const revisions = new Map<string, number>();
  const key = (operation: WorkflowOperation, idempotencyKey: string): string => `${operation}:${idempotencyKey}`;
  return Object.freeze({
    async execute<T>(input: { readonly fingerprint: string; readonly idempotencyKey: string; readonly operation: WorkflowOperation; readonly revisionScope?: string }, action: () => Promise<T>): Promise<Readonly<WorkflowCommandResult<T>>> {
      const id = key(input.operation, input.idempotencyKey);
      const existing = entries.get(id);
      if (existing !== undefined) {
        if (existing.fingerprint !== input.fingerprint) throw new WorkflowError("WORKFLOW_IDEMPOTENCY_CONFLICT");
        if (existing.status === "completed") return existing.result as Readonly<WorkflowCommandResult<T>>;
        if (existing.status === "reconciliation_required") throw existing.error;
        return existing.promise as Promise<Readonly<WorkflowCommandResult<T>>>;
      }
      const promise = action().then((value) => {
        if (input.revisionScope === undefined) return Object.freeze({ value });
        const sourceRevision = (revisions.get(input.revisionScope) ?? 0) + 1;
        revisions.set(input.revisionScope, sourceRevision);
        return Object.freeze({ sourceRevision, value });
      });
      entries.set(id, { fingerprint: input.fingerprint, promise, status: "running" });
      try {
        const result = await promise;
        entries.set(id, { fingerprint: input.fingerprint, result, status: "completed" });
        return result;
      } catch (error) {
        if (error instanceof WorkflowError && error.code === "WORKFLOW_RECONCILIATION_REQUIRED") entries.set(id, { error, fingerprint: input.fingerprint, status: "reconciliation_required" });
        else if (entries.get(id)?.status === "running") entries.delete(id);
        throw error;
      }
    },
    getStatus(input: { readonly idempotencyKey: string; readonly operation: WorkflowOperation }): Promise<WorkflowCommandStatus> {
      return Promise.resolve(entries.get(key(input.operation, input.idempotencyKey))?.status ?? "absent");
    },
  });
};
