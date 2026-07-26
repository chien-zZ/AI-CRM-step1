export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface EventEnvelope {
  readonly specversion: "1.0";
  readonly id: string;
  readonly source: string;
  readonly type: string;
  readonly time: string;
  readonly datacontenttype: "application/json";
  readonly dataschema: string;
  readonly correlationid: string;
  readonly data: JsonValue;
  readonly subject?: string;
  readonly causationid?: string;
  readonly traceparent?: string;
  readonly tracestate?: string;
}

export interface JobEnvelope {
  readonly jobId: string;
  readonly jobType: string;
  readonly jobVersion: number;
  readonly source: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly notBefore?: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly traceparent?: string;
  readonly tracestate?: string;
  readonly policy: {
    readonly maxAttempts: number;
    readonly backoffSeconds: readonly number[];
    readonly timeoutMs: number;
    readonly failureDisposition: "isolate";
  };
  readonly payload: JsonValue;
}

export type MessageEnvelope = EventEnvelope | JobEnvelope;
export type MessageKind = "event" | "job";

export interface ValidatedMessage {
  readonly envelope: MessageEnvelope;
  readonly messageId: string;
  readonly messageKind: MessageKind;
  readonly messageType: string;
  readonly messageVersion: number;
  readonly producer: string;
  readonly occurredAt: Date;
  readonly availableAt: Date;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly traceparent?: string;
  readonly tracestate?: string;
  readonly serialized: string;
  readonly payloadSha256: string;
}

export interface MessageHandler {
  readonly kind: MessageKind;
  readonly messageType: string;
  readonly messageVersion: number;
  recheckAuthoritativeState?(message: ValidatedMessage, signal: AbortSignal): Promise<boolean>;
  handle(message: ValidatedMessage, signal: AbortSignal): Promise<void>;
}

export interface EventingCore {
  appendEvent(envelope: unknown): Promise<{ readonly messageId: string; readonly status: "pending" }>;
  submitJob(envelope: unknown): Promise<{ readonly jobId: string; readonly status: JobStatus }>;
  cancelJob(jobId: string, reason: string): Promise<{ readonly jobId: string; readonly status: JobStatus }>;
  consume(input: { readonly attempt: number; readonly consumer: string; readonly envelope: unknown; readonly timeoutMs?: number }, handler: MessageHandler): Promise<ConsumptionResult>;
}

export type JobStatus = "queued" | "processing" | "cancelled" | "completed" | "isolated";
export type ConsumptionResult =
  | { readonly status: "completed" | "duplicate" }
  | { readonly status: "skipped"; readonly reason: "job_cancelled" | "authoritative_state_rejected" }
  | { readonly status: "isolated"; readonly reason: "payload_conflict" | "unsupported_message" };

export interface OutboxPublication {
  readonly attempt: number;
  readonly messageId: string;
  readonly messageKind: MessageKind;
  readonly messageType: string;
  readonly messageVersion: number;
  readonly producer: string;
  readonly correlationId: string;
  readonly payload: string;
  readonly causationId?: string;
  readonly traceparent?: string;
  readonly tracestate?: string;
}

export interface ConfirmingMessageTransport { publish(message: OutboxPublication): Promise<void>; }
export interface PublishBatchResult { readonly claimed: number; readonly published: number; readonly retained: number; readonly isolated: number; }
export interface EventingBacklog { readonly pendingCount: number; readonly publishingCount: number; readonly isolatedCount: number; readonly inboxReceiptCount: number; readonly queuedJobCount: number; readonly oldestPendingAt?: string; }
export interface EventingReconciliationInput { readonly expectedInbox: readonly { readonly messageId: string; readonly consumer: string }[]; readonly expectedOutboxMessageIds: readonly string[]; }
export interface EventingReconciliationReport { readonly missingInbox: readonly { readonly messageId: string; readonly consumer: string }[]; readonly missingOutboxMessageIds: readonly string[]; readonly isolatedOutboxMessageIds: readonly string[]; }
export interface EventingObservation { readonly operation: "append_event" | "submit_job" | "cancel_job" | "consume" | "publish_batch"; readonly outcome: "completed" | "duplicate" | "failed" | "isolated" | "retained" | "skipped"; readonly durationMs: number; readonly count?: number; }
export interface EventingObserver { record(observation: EventingObservation): void; }

export interface EventingOperationalControl {
  authorize(input: { readonly operation: "outbox_replay"; readonly referenceId: string }): Promise<{ readonly allowed: boolean; readonly decisionId: string }>;
  record(input: { readonly operation: "outbox_replay"; readonly referenceId: string; readonly decisionId: string; readonly reason: string }): Promise<void>;
}
