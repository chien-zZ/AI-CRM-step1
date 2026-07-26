import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { EventingError } from "./errors.js";
import { outboxRecord, type EventingStore, type IsolationRecord, type JobRecord } from "./store.js";
import type { ConsumptionResult, EventingCore, EventingObservation, EventingObserver, JobEnvelope, MessageHandler, ValidatedMessage } from "./types.js";
import { validateConsumerName, validateEventEnvelope, validateJobEnvelope, validateMessageEnvelope, validateReason, validateUuid } from "./validation.js";

const matches = (handler: MessageHandler, message: ValidatedMessage): boolean => handler.kind === message.messageKind && handler.messageType === message.messageType && handler.messageVersion === message.messageVersion;
const record=(observer:EventingObserver|undefined,observation:EventingObservation):void=>{try{observer?.record(observation);}catch{/* Telemetry cannot change message correctness. */}};
const duration=(started:number):number=>Math.max(0,Math.round(performance.now()-started));
const withTimeout=async<T>(milliseconds:number,work:(signal:AbortSignal)=>Promise<T>):Promise<T>=>{const controller=new AbortController();const timer=setTimeout(()=>{controller.abort();},milliseconds);const expired=():boolean=>controller.signal.aborted;try{const result=await work(controller.signal);if(expired())throw new EventingError("eventing_handler_timeout",true);return result;}catch(error){if(expired())throw new EventingError("eventing_handler_timeout",true);throw error;}finally{clearTimeout(timer);}};

export function createEventingCore(store: EventingStore, options: { readonly clock?: () => Date; readonly isolationId?: () => string; readonly observer?: EventingObserver } = {}): EventingCore {
  const clock = options.clock ?? (() => new Date()); const isolationId = options.isolationId ?? randomUUID;
  const isolate = async (message: ValidatedMessage, consumer: string, attempt: number, reason: IsolationRecord["reason"]): Promise<ConsumptionResult> => {
    await store.createIsolation({ isolationId: validateUuid(isolationId()), messageId: message.messageId, consumer, payloadSha256: message.payloadSha256, reason, attempt, isolatedAt: clock() });
    return reason === "authoritative_state_rejected" ? { status: "skipped", reason } : { status: "isolated", reason };
  };
  const core: EventingCore = {
    async appendEvent(input: unknown) {
      const started=performance.now();
      const message = validateEventEnvelope(input);
      try { await store.appendOutbox(outboxRecord(message)); } catch (error) {
        if (error instanceof EventingError && error.code === "eventing_conflict" && (await store.getOutbox(message.messageId))?.payloadSha256 === message.payloadSha256){record(options.observer,{operation:"append_event",outcome:"duplicate",durationMs:duration(started)});return { messageId: message.messageId, status: "pending" };}
        record(options.observer,{operation:"append_event",outcome:"failed",durationMs:duration(started)});
        throw error;
      }
      record(options.observer,{operation:"append_event",outcome:"completed",durationMs:duration(started)});
      return { messageId: message.messageId, status: "pending" };
    },
    async submitJob(input: unknown) {
      const started=performance.now();
      const message = validateJobEnvelope(input); const envelope = message.envelope as JobEnvelope;
      const prior = await store.findJobByIdempotencyKey(envelope.idempotencyKey);
      if (prior) { if (prior.fingerprint !== message.payloadSha256) throw new EventingError("eventing_conflict");record(options.observer,{operation:"submit_job",outcome:"duplicate",durationMs:duration(started)}); return { jobId: prior.jobId, status: prior.status }; }
      const job: JobRecord = { jobId: envelope.jobId, idempotencyKey: envelope.idempotencyKey, fingerprint: message.payloadSha256, status: "queued", envelope };
      try { await store.transaction(async () => { await store.createJob(job); await store.appendOutbox(outboxRecord(message)); }); }
      catch(error){ if(error instanceof EventingError&&error.code==="eventing_conflict"){const raced=await store.findJobByIdempotencyKey(envelope.idempotencyKey);if(raced?.fingerprint===message.payloadSha256)return{jobId:raced.jobId,status:raced.status};}throw error; }
      record(options.observer,{operation:"submit_job",outcome:"completed",durationMs:duration(started)});return { jobId: job.jobId, status: job.status };
    },
    async cancelJob(jobIdInput: string, reasonInput: string) {
      const started=performance.now();const jobId = validateUuid(jobIdInput); const reason = validateReason(reasonInput);const row=await store.cancelJob(jobId,reason);
      if (!row) throw new EventingError("eventing_not_found");record(options.observer,{operation:"cancel_job",outcome:"completed",durationMs:duration(started)});return { jobId, status: row.status };
    },
    async consume(request: { readonly attempt: number; readonly consumer: string; readonly envelope: unknown; readonly timeoutMs?: number }, handler: MessageHandler) {
      const consumer = validateConsumerName(request.consumer);
      if (!Number.isInteger(request.attempt) || request.attempt < 1 || request.attempt > 1000) throw new EventingError("eventing_invalid_input");
      const message = validateMessageEnvelope(request.envelope);
      const timeoutMs=message.messageKind==="job"?(message.envelope as JobEnvelope).policy.timeoutMs:request.timeoutMs;
      if(!Number.isInteger(timeoutMs)||timeoutMs===undefined||timeoutMs<100||timeoutMs>900000)throw new EventingError("eventing_invalid_input");
      const started=performance.now();
      if (!matches(handler, message)){const result=await isolate(message, consumer, request.attempt, "unsupported_message");record(options.observer,{operation:"consume",outcome:"isolated",durationMs:duration(started)});return result;}
      const receipt = await store.findInboxReceipt(message.messageId, consumer);
      if (receipt){if(receipt.payloadSha256===message.payloadSha256){record(options.observer,{operation:"consume",outcome:"duplicate",durationMs:duration(started)});return{status:"duplicate"};}const result=await isolate(message,consumer,request.attempt,"payload_conflict");record(options.observer,{operation:"consume",outcome:"isolated",durationMs:duration(started)});return result;}
      try{const result=await store.withInboxTransaction(message.messageId,consumer,async () => {
        const raced = await store.findInboxReceipt(message.messageId, consumer);
        if (raced) return raced.payloadSha256 === message.payloadSha256 ? { status: "duplicate" as const } : isolate(message, consumer, request.attempt, "payload_conflict");
        if (handler.kind === "job") {
          const existing=await store.findJob(message.messageId);if(!existing||existing.fingerprint!==message.payloadSha256)return isolate(message,consumer,request.attempt,"payload_conflict");
          const job=await store.claimJob(message.messageId);
          if(!job){const current=await store.findJob(message.messageId);if(current?.status==="cancelled"||current?.status==="completed"){await store.createInboxReceipt({messageId:message.messageId,consumer,payloadSha256:message.payloadSha256,completedAt:clock()});return{status:"skipped" as const,reason:"job_cancelled" as const};}if(current?.status==="isolated"){await store.createInboxReceipt({messageId:message.messageId,consumer,payloadSha256:message.payloadSha256,completedAt:clock()});return{status:"skipped" as const,reason:"authoritative_state_rejected" as const};}throw new EventingError("eventing_conflict",true);}
          const authoritative=await withTimeout(timeoutMs,async(signal)=>{const allowed=handler.recheckAuthoritativeState!==undefined&&await handler.recheckAuthoritativeState(message,signal);if(allowed)await handler.handle(message,signal);return allowed;});
          if(!authoritative){
            const isolatedJob=await store.isolateJob(job.jobId);
            if(!isolatedJob)throw new EventingError("eventing_conflict",true);
            const isolated=await isolate(message,consumer,request.attempt,"authoritative_state_rejected");
            await store.createInboxReceipt({messageId:message.messageId,consumer,payloadSha256:message.payloadSha256,completedAt:clock()});
            return isolated;
          }
        }else await withTimeout(timeoutMs,(signal)=>handler.handle(message,signal));
        if (handler.kind === "job"&&!await store.completeJob(message.messageId))throw new EventingError("eventing_conflict",true);
        await store.createInboxReceipt({ messageId: message.messageId, consumer, payloadSha256: message.payloadSha256, completedAt: clock() });
        return { status: "completed" as const };
      });record(options.observer,{operation:"consume",outcome:result.status==="duplicate"?"duplicate":result.status==="isolated"?"isolated":result.status==="skipped"?"skipped":"completed",durationMs:duration(started)});return result;}catch(error){record(options.observer,{operation:"consume",outcome:"failed",durationMs:duration(started)});throw error;}
    },
  };
  return Object.freeze(core);
}
