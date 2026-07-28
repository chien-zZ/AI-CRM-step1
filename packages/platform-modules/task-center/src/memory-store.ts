import { TaskCenterError } from "./errors.js";
import { fingerprint } from "./validation.js";
import type { ProjectionApplyResult, TaskCenterStore, TaskCommandClaim, TaskCommandResult, TaskLifecycleEvent, TaskPage, TaskProjection, TaskProjectionKey, TaskProjectionStatus } from "./types.js";

const keyOf = (value: TaskProjectionKey): string => `${value.sourceType}\u0000${value.sourceTaskId}`;
const projectionOf = (event: TaskLifecycleEvent, projectionId: string, createdAt: string): TaskProjection => ({ projectionId, sourceType: event.sourceType, sourceTaskId: event.sourceTaskId, sourceVersion: event.sourceVersion, status: event.status, deepLink: event.deepLink, createdAt, updatedAt: event.occurredAt, ...(event.assigneeReference === undefined ? {} : { assigneeReference: event.assigneeReference }), ...(event.candidateScopeReference === undefined ? {} : { candidateScopeReference: event.candidateScopeReference }), ...(event.dueAt === undefined ? {} : { dueAt: event.dueAt }) });
export class InMemoryTaskCenterStore implements TaskCenterStore {
  private readonly projections = new Map<string, TaskProjection>();
  private readonly events = new Map<string, string>();
  private readonly commands = new Map<string, { fingerprint: string; leaseExpiresAt?: Date; leaseToken?: string; result?: TaskCommandResult; status: "accepted" | "running" }>();
  public apply(event: TaskLifecycleEvent, signal?: AbortSignal): Promise<ProjectionApplyResult> {
    signal?.throwIfAborted();
    const eventFingerprint = fingerprint(event);
    const seen = this.events.get(event.eventId);
    if (seen !== undefined) {
      if (seen !== eventFingerprint) throw new TaskCenterError("TASK_COMMAND_CONFLICT");
      const existing = this.projections.get(keyOf(event));
      if (!existing) throw new TaskCenterError("TASK_STORAGE_UNAVAILABLE", { retryable: true });
      return Promise.resolve({ status: "duplicate", projection: existing });
    }
    const existing = this.projections.get(keyOf(event));
    if (existing !== undefined && event.sourceVersion <= existing.sourceVersion) {
      this.events.set(event.eventId, eventFingerprint);
      return Promise.resolve({ status: "stale", projection: existing });
    }
    const projection = projectionOf(event, existing?.projectionId ?? event.eventId, existing?.createdAt ?? event.occurredAt);
    this.projections.set(keyOf(event), projection); this.events.set(event.eventId, eventFingerprint);
    return Promise.resolve({ status: "applied", projection });
  }
  public reconcile(event: TaskLifecycleEvent): Promise<ProjectionApplyResult> {
    const eventFingerprint=fingerprint(event);const seen=this.events.get(event.eventId);if(seen!==undefined&&seen!==eventFingerprint)throw new TaskCenterError("TASK_COMMAND_CONFLICT");
    const existing=this.projections.get(keyOf(event));
    if(existing!==undefined&&event.sourceVersion<existing.sourceVersion)return Promise.resolve({status:"stale",projection:existing});
    const projection=projectionOf(event,existing?.projectionId??event.eventId,existing?.createdAt??event.occurredAt);
    const current=existing!==undefined&&fingerprint(existing)===fingerprint(projection);
    this.projections.set(keyOf(event),projection);this.events.set(event.eventId,eventFingerprint);
    return Promise.resolve({status:current?"duplicate":"applied",projection});
  }
  public get(key: TaskProjectionKey): Promise<TaskProjection | undefined> { return Promise.resolve(this.projections.get(keyOf(key))); }
  public list(input: { status?: TaskProjectionStatus; limit: number; cursor?: string }): Promise<TaskPage> {
    const rows = [...this.projections.values()].filter((item) => input.status === undefined || item.status === input.status).sort((a,b) => keyOf(a).localeCompare(keyOf(b))).filter((item) => input.cursor === undefined || keyOf(item) > input.cursor);
    const items = rows.slice(0,input.limit); const last = items.at(-1); return Promise.resolve({ items, ...(rows.length > items.length && last ? { nextCursor: keyOf(last) } : {}) });
  }
  public claimCommand(input: { idempotencyKey: string; fingerprint: string; leaseToken: string; now: Date; leaseExpiresAt: Date }): Promise<TaskCommandClaim> {
    const row=this.commands.get(input.idempotencyKey);
    if(row?.fingerprint!==undefined&&row.fingerprint!==input.fingerprint)throw new TaskCenterError("TASK_COMMAND_CONFLICT");
    if(row?.status==="accepted"&&row.result)return Promise.resolve({status:"accepted",result:row.result});
    if(row?.status==="running"&&row.leaseExpiresAt!==undefined&&row.leaseExpiresAt>input.now)return Promise.resolve({status:"running"});
    this.commands.set(input.idempotencyKey,{fingerprint:input.fingerprint,status:"running",leaseToken:input.leaseToken,leaseExpiresAt:input.leaseExpiresAt});
    return Promise.resolve({status:"claimed",leaseToken:input.leaseToken});
  }
  public acceptCommand(input: { idempotencyKey: string; leaseToken: string; result: TaskCommandResult }): Promise<boolean> { const row=this.commands.get(input.idempotencyKey);if(row?.status!=="running"||row.leaseToken!==input.leaseToken)return Promise.resolve(false);this.commands.set(input.idempotencyKey,{fingerprint:row.fingerprint,result:input.result,status:"accepted"});return Promise.resolve(true); }
  public releaseCommand(input: { idempotencyKey: string; leaseToken: string }): Promise<void> { const row=this.commands.get(input.idempotencyKey);if(row?.status==="running"&&row.leaseToken===input.leaseToken)this.commands.delete(input.idempotencyKey);return Promise.resolve(); }
}
