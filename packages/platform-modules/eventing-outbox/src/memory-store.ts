import { EventingError } from "./errors.js";
import type { EventingBacklog, EventingReconciliationInput, EventingReconciliationReport } from "./types.js";
import type { ClaimedOutboxRecord, EventingStore, InboxReceipt, IsolationRecord, JobRecord, OutboxRecord } from "./store.js";

const inboxKey = (messageId: string, consumer: string): string => `${messageId}\0${consumer}`;

export class InMemoryEventingStore implements EventingStore {
  readonly outbox = new Map<string, OutboxRecord>(); readonly inbox = new Map<string, InboxReceipt>();
  readonly jobs = new Map<string, JobRecord>(); readonly isolations = new Map<string, IsolationRecord>();
  failPublishedUpdate = false;
  readonly #inboxLocks = new Map<string, Promise<void>>();

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    const snapshots = [structuredClone(this.outbox), structuredClone(this.inbox), structuredClone(this.jobs), structuredClone(this.isolations)] as const;
    try { return await work(); } catch (error) {
      this.outbox.clear(); snapshots[0].forEach((v, k) => this.outbox.set(k, v)); this.inbox.clear(); snapshots[1].forEach((v, k) => this.inbox.set(k, v));
      this.jobs.clear(); snapshots[2].forEach((v, k) => this.jobs.set(k, v)); this.isolations.clear(); snapshots[3].forEach((v, k) => this.isolations.set(k, v)); throw error;
    }
  }
  async withInboxTransaction<T>(messageId:string,consumer:string,work:()=>Promise<T>):Promise<T>{
    const key=inboxKey(messageId,consumer);const previous=this.#inboxLocks.get(key)??Promise.resolve();let release:()=>void=()=>undefined;const current=new Promise<void>((resolve)=>{release=resolve;});this.#inboxLocks.set(key,current);await previous;
    try{return await this.transaction(work);}finally{release();if(this.#inboxLocks.get(key)===current)this.#inboxLocks.delete(key);}
  }
  appendOutbox(record: OutboxRecord): Promise<void> { if (this.outbox.has(record.messageId)) return Promise.reject(new EventingError("eventing_conflict")); this.outbox.set(record.messageId, structuredClone(record)); return Promise.resolve(); }
  getOutbox(id: string): Promise<OutboxRecord | undefined> { return Promise.resolve(structuredClone(this.outbox.get(id))); }
  claimOutbox(input: { readonly at: Date; readonly staleBefore: Date; readonly limit: number; readonly token: () => string }): Promise<readonly ClaimedOutboxRecord[]> {
    return Promise.resolve([...this.outbox.values()].filter((row) => (row.status === "pending" && row.availableAt <= input.at) || (row.status === "publishing" && row.claimedAt !== undefined && row.claimedAt <= input.staleBefore)).sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime()).slice(0, input.limit).map((row) => {
      const next: ClaimedOutboxRecord = { ...row, status: "publishing", attemptCount: row.attemptCount + 1, claimToken: input.token(), claimedAt: input.at };
      this.outbox.set(row.messageId, next); return structuredClone(next);
    }));
  }
  markOutboxPublished(id: string, token: string, at: Date): Promise<boolean> { if (this.failPublishedUpdate) return Promise.reject(new EventingError("eventing_storage_unavailable", true)); const row = this.outbox.get(id); if (row?.status !== "publishing" || row.claimToken !== token) return Promise.resolve(false); const { claimToken, claimedAt, ...rest } = row; void claimToken; void claimedAt; this.outbox.set(id, { ...rest, status: "published", publishedAt: at }); return Promise.resolve(true); }
  markOutboxFailure(input: { readonly messageId: string; readonly claimToken: string; readonly at: Date; readonly availableAt: Date; readonly errorCode: string; readonly isolate: boolean }): Promise<boolean> { const row = this.outbox.get(input.messageId); if (row?.status !== "publishing" || row.claimToken !== input.claimToken) return Promise.resolve(false); const { claimToken, claimedAt, isolatedAt, ...rest } = row; void claimToken; void claimedAt; void isolatedAt; this.outbox.set(input.messageId, { ...rest, status: input.isolate ? "isolated" : "pending", availableAt: input.availableAt, lastErrorCode: input.errorCode, ...(input.isolate ? { isolatedAt: input.at } : {}) }); return Promise.resolve(true); }
  replayOutbox(id: string, at: Date): Promise<boolean> { const row = this.outbox.get(id); if (row?.status !== "isolated") return Promise.resolve(false); const { isolatedAt, lastErrorCode, ...rest } = row; void isolatedAt; void lastErrorCode; this.outbox.set(id, { ...rest, status: "pending", attemptCount: 0, availableAt: at }); return Promise.resolve(true); }
  findInboxReceipt(id: string, consumer: string): Promise<InboxReceipt | undefined> { return Promise.resolve(structuredClone(this.inbox.get(inboxKey(id, consumer)))); }
  createInboxReceipt(row: InboxReceipt): Promise<void> { const key = inboxKey(row.messageId, row.consumer); if (this.inbox.has(key)) return Promise.reject(new EventingError("eventing_conflict")); this.inbox.set(key, structuredClone(row)); return Promise.resolve(); }
  createIsolation(row: IsolationRecord): Promise<void> { const duplicate=[...this.isolations.values()].some((item)=>item.messageId===row.messageId&&item.consumer===row.consumer&&item.payloadSha256===row.payloadSha256&&item.reason===row.reason); if(!duplicate)this.isolations.set(row.isolationId, structuredClone(row)); return Promise.resolve(); }
  findJob(id: string): Promise<JobRecord | undefined> { return Promise.resolve(structuredClone(this.jobs.get(id))); }
  findJobByIdempotencyKey(key: string): Promise<JobRecord | undefined> { return Promise.resolve(structuredClone([...this.jobs.values()].find((row) => row.idempotencyKey === key))); }
  createJob(row: JobRecord): Promise<void> { if (this.jobs.has(row.jobId) || [...this.jobs.values()].some((item) => item.idempotencyKey === row.idempotencyKey)) return Promise.reject(new EventingError("eventing_conflict")); this.jobs.set(row.jobId, structuredClone(row)); return Promise.resolve(); }
  claimJob(id:string):Promise<JobRecord|undefined>{const row=this.jobs.get(id);if(row?.status!=="queued")return Promise.resolve(undefined);const next={...row,status:"processing" as const};this.jobs.set(id,next);return Promise.resolve(structuredClone(next));}
  cancelJob(id:string,reason:string):Promise<JobRecord|undefined>{const row=this.jobs.get(id);if(!row)return Promise.resolve(undefined);if(row.status!=="queued")return Promise.resolve(structuredClone(row));const next={...row,status:"cancelled" as const,cancelReason:reason};this.jobs.set(id,next);return Promise.resolve(structuredClone(next));}
  completeJob(id:string):Promise<boolean>{const row=this.jobs.get(id);if(row?.status!=="processing")return Promise.resolve(false);this.jobs.set(id,{...row,status:"completed"});return Promise.resolve(true);}
  isolateJob(id:string):Promise<boolean>{const row=this.jobs.get(id);if(row?.status!=="processing")return Promise.resolve(false);this.jobs.set(id,{...row,status:"isolated"});return Promise.resolve(true);}
  backlog(): Promise<EventingBacklog> { const pending = [...this.outbox.values()].filter((row) => row.status === "pending"); const oldest = pending.sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime())[0]; return Promise.resolve({ pendingCount: pending.length, publishingCount: [...this.outbox.values()].filter((row) => row.status === "publishing").length, isolatedCount: this.isolations.size+[...this.outbox.values()].filter((row)=>row.status==="isolated").length, inboxReceiptCount: this.inbox.size, queuedJobCount: [...this.jobs.values()].filter((row) => row.status === "queued").length, ...(oldest === undefined ? {} : { oldestPendingAt: oldest.availableAt.toISOString() }) }); }
  reconcile(input:EventingReconciliationInput):Promise<EventingReconciliationReport>{return Promise.resolve({missingOutboxMessageIds:input.expectedOutboxMessageIds.filter((id)=>!this.outbox.has(id)),isolatedOutboxMessageIds:input.expectedOutboxMessageIds.filter((id)=>this.outbox.get(id)?.status==="isolated"),missingInbox:input.expectedInbox.filter(({messageId,consumer})=>!this.inbox.has(inboxKey(messageId,consumer)))});}
}
