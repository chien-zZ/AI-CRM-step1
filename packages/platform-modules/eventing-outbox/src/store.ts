import type { EventingBacklog, EventingReconciliationInput, EventingReconciliationReport, JobEnvelope, JobStatus, MessageKind, ValidatedMessage } from "./types.js";

export interface OutboxRecord {
  readonly messageId: string; readonly messageKind: MessageKind; readonly messageType: string; readonly messageVersion: number;
  readonly producer: string; readonly occurredAt: Date; readonly availableAt: Date; readonly correlationId: string;
  readonly payload: string; readonly payloadSha256: string; readonly attemptCount: number;
  readonly status: "pending" | "publishing" | "published" | "isolated";
  readonly causationId?: string; readonly traceparent?: string; readonly tracestate?: string;
  readonly claimToken?: string; readonly claimedAt?: Date; readonly publishedAt?: Date; readonly isolatedAt?: Date; readonly lastErrorCode?: string;
}
export interface ClaimedOutboxRecord extends OutboxRecord { readonly status: "publishing"; readonly claimToken: string; readonly claimedAt: Date; }
export interface InboxReceipt { readonly messageId: string; readonly consumer: string; readonly payloadSha256: string; readonly completedAt: Date; }
export interface JobRecord { readonly jobId: string; readonly idempotencyKey: string; readonly fingerprint: string; readonly status: JobStatus; readonly envelope: JobEnvelope; readonly cancelReason?: string; }
export interface IsolationRecord { readonly isolationId: string; readonly messageId: string; readonly consumer: string; readonly payloadSha256: string; readonly reason: "payload_conflict" | "unsupported_message" | "authoritative_state_rejected"; readonly attempt: number; readonly isolatedAt: Date; }

export interface EventingStore {
  transaction<T>(work: () => Promise<T>): Promise<T>;
  withInboxTransaction<T>(messageId: string, consumer: string, work: () => Promise<T>): Promise<T>;
  appendOutbox(record: OutboxRecord): Promise<void>;
  getOutbox(messageId: string): Promise<OutboxRecord | undefined>;
  claimOutbox(input: { readonly at: Date; readonly staleBefore: Date; readonly limit: number; readonly token: () => string }): Promise<readonly ClaimedOutboxRecord[]>;
  markOutboxPublished(messageId: string, claimToken: string, at: Date): Promise<boolean>;
  markOutboxFailure(input: { readonly messageId: string; readonly claimToken: string; readonly at: Date; readonly availableAt: Date; readonly errorCode: string; readonly isolate: boolean }): Promise<boolean>;
  replayOutbox(messageId: string, at: Date): Promise<boolean>;
  findInboxReceipt(messageId: string, consumer: string): Promise<InboxReceipt | undefined>;
  createInboxReceipt(record: InboxReceipt): Promise<void>;
  createIsolation(record: IsolationRecord): Promise<void>;
  findJob(jobId: string): Promise<JobRecord | undefined>;
  findJobByIdempotencyKey(key: string): Promise<JobRecord | undefined>;
  createJob(record: JobRecord): Promise<void>;
  claimJob(jobId: string): Promise<JobRecord | undefined>;
  cancelJob(jobId: string, reason: string): Promise<JobRecord | undefined>;
  completeJob(jobId: string): Promise<boolean>;
  isolateJob(jobId: string): Promise<boolean>;
  backlog(): Promise<EventingBacklog>;
  reconcile(input: EventingReconciliationInput): Promise<EventingReconciliationReport>;
}

export const outboxRecord = (message: ValidatedMessage): OutboxRecord => ({
  messageId: message.messageId, messageKind: message.messageKind, messageType: message.messageType, messageVersion: message.messageVersion,
  producer: message.producer, occurredAt: message.occurredAt, availableAt: message.availableAt, correlationId: message.correlationId,
  payload: message.serialized, payloadSha256: message.payloadSha256, attemptCount: 0, status: "pending",
  ...(message.causationId === undefined ? {} : { causationId: message.causationId }), ...(message.traceparent === undefined ? {} : { traceparent: message.traceparent }), ...(message.tracestate === undefined ? {} : { tracestate: message.tracestate }),
});
