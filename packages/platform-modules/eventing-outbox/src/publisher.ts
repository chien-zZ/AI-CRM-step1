import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { EventingError } from "./errors.js";
import type { EventingStore } from "./store.js";
import type { ConfirmingMessageTransport, EventingObserver, PublishBatchResult } from "./types.js";

export interface OutboxPublisher { publishBatch(): Promise<PublishBatchResult>; }

export function createOutboxPublisher(store: EventingStore, transport: ConfirmingMessageTransport, options: { readonly batchSize: number; readonly claimLeaseSeconds: number; readonly maxAttempts: number; readonly backoffSeconds: readonly number[]; readonly clock?: () => Date; readonly claimToken?: () => string; readonly observer?: EventingObserver }): OutboxPublisher {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 1000 || !Number.isInteger(options.claimLeaseSeconds) || options.claimLeaseSeconds < 1 || !Number.isInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts>16 || options.backoffSeconds.length !== options.maxAttempts - 1||options.backoffSeconds.some((value)=>!Number.isInteger(value)||value<1||value>86400)) throw new EventingError("eventing_invalid_input");
  const clock = options.clock ?? (() => new Date()); const token = options.claimToken ?? randomUUID;
  return Object.freeze({ async publishBatch() {
    const started=performance.now();
    const at = clock(); const records = await store.claimOutbox({ at, staleBefore: new Date(at.getTime() - options.claimLeaseSeconds * 1000), limit: options.batchSize, token });
    let published = 0; let retained = 0; let isolated = 0;
    for (const row of records) {
      let transportConfirmed = false;
      try {
        await transport.publish({ attempt: row.attemptCount, messageId: row.messageId, messageKind: row.messageKind, messageType: row.messageType, messageVersion: row.messageVersion, producer: row.producer, correlationId: row.correlationId, payload: row.payload, ...(row.causationId === undefined ? {} : { causationId: row.causationId }), ...(row.traceparent === undefined ? {} : { traceparent: row.traceparent }), ...(row.tracestate === undefined ? {} : { tracestate: row.tracestate }) });
        transportConfirmed = true;
        if (!(await store.markOutboxPublished(row.messageId, row.claimToken, clock()))) throw new EventingError("eventing_storage_unavailable", true);
        published++;
      } catch (error) {
        // Once Broker confirm succeeds, transport failure policy no longer
        // applies. Keep the claim for stale-lease recovery and surface storage
        // uncertainty; isolating this row would falsely describe delivery.
        if (transportConfirmed) throw error instanceof EventingError ? error : new EventingError("eventing_storage_unavailable", true);
        const exhaust = row.attemptCount >= options.maxAttempts; const seconds = options.backoffSeconds[row.attemptCount - 1] ?? 0;
        let marked = false;
        try { marked = await store.markOutboxFailure({ messageId: row.messageId, claimToken: row.claimToken, at: clock(), availableAt: new Date(clock().getTime() + seconds * 1000), errorCode: error instanceof EventingError ? error.code : "publish_failed", isolate: exhaust }); }
        catch { throw new EventingError("eventing_storage_unavailable", true); }
        if (!marked) throw new EventingError("eventing_storage_unavailable", true);
        if (exhaust) isolated++; else retained++;
      }
    }
    try{options.observer?.record({operation:"publish_batch",outcome:isolated>0?"isolated":retained>0?"retained":"completed",durationMs:Math.max(0,Math.round(performance.now()-started)),count:records.length});}catch{/* Telemetry cannot change publication correctness. */}
    return { claimed: records.length, published, retained, isolated };
  } });
}
