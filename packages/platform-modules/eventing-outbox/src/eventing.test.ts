import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { EventingError } from "./errors.js";
import { InMemoryEventingStore } from "./memory-store.js";
import { createEventingOperations } from "./operations.js";
import { createOutboxPublisher } from "./publisher.js";
import { createRabbitConfirmTransport, handleRabbitDelivery, type RabbitConfirmChannel } from "./rabbit.js";
import { createEventingCore } from "./service.js";
import { validateEventEnvelope, validateJobEnvelope } from "./validation.js";

const at = "2026-07-26T00:00:00.000Z";
const event = (id = randomUUID()) => ({ specversion: "1.0", id, source: "urn:ai-crm:walking-skeleton", type: "platform.synthetic.changed.v1", time: at, datacontenttype: "application/json", dataschema: "urn:ai-crm:events:synthetic:changed:v1", correlationid: randomUUID(), data: { reference: "synthetic-only" } });
const job = (id = randomUUID(), key = `synthetic:${randomUUID()}`) => ({ jobId: id, jobType: "platform.synthetic-check", jobVersion: 1, source: "urn:ai-crm:walking-skeleton", idempotencyKey: key, requestedAt: at, correlationId: randomUUID(), policy: { maxAttempts: 3, backoffSeconds: [1, 5], timeoutMs: 1000, failureDisposition: "isolate" }, payload: { reference: "synthetic-only" } });

describe("event and job envelope validation", () => {
  it("normalizes bounded envelopes and propagates correlation and trace context", () => {
    const input = { ...event(), traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" };
    expect(validateEventEnvelope(input)).toMatchObject({ correlationId: input.correlationid, messageVersion: 1, traceparent: input.traceparent });
    expect(validateJobEnvelope(job())).toMatchObject({ messageKind: "job", messageVersion: 1 });
  });
  it("rejects unknown fields, invalid versions, and inconsistent retry schedules", () => {
    expect(() => validateEventEnvelope({ ...event(), queue: "invented" })).toThrowError(EventingError);
    expect(() => validateJobEnvelope({ ...job(), policy: { maxAttempts: 3, backoffSeconds: [1], timeoutMs: 1000, failureDisposition: "isolate" } })).toThrowError(EventingError);
  });
});

describe("transactional core", () => {
  it("rolls back job and Outbox together", async () => {
    const store = new InMemoryEventingStore(); const core = createEventingCore(store); const input = job();
    const append = store.appendOutbox.bind(store); store.appendOutbox = async (row) => { if (row.messageKind === "job") throw new Error("synthetic rollback"); return append(row); };
    await expect(core.submitJob(input)).rejects.toThrow("synthetic rollback");
    expect(store.jobs.size).toBe(0); expect(store.outbox.size).toBe(0);
  });
  it("commits one handler side effect and one Inbox receipt across duplicate delivery and lost ACK", async () => {
    const store = new InMemoryEventingStore(); const core = createEventingCore(store); const input = event(); let effects = 0;
    const handler = { kind: "event" as const, messageType: input.type, messageVersion: 1, handle: () => { effects++; return Promise.resolve(); } };
    await expect(core.consume({ attempt: 1, consumer: "platform.synthetic-projection", envelope: input, timeoutMs:1000 }, handler)).resolves.toEqual({ status: "completed" });
    await expect(core.consume({ attempt: 2, consumer: "platform.synthetic-projection", envelope: input, timeoutMs:1000 }, handler)).resolves.toEqual({ status: "duplicate" });
    expect(effects).toBe(1); expect(store.inbox.size).toBe(1);
  });
  it("rolls back a handler side effect contract when the handler fails before receipt commit", async () => {
    const store = new InMemoryEventingStore(); const core = createEventingCore(store); const input = event();
    await expect(core.consume({ attempt: 1, consumer: "platform.synthetic-projection", envelope: input, timeoutMs:1000 }, { kind: "event", messageType: input.type, messageVersion: 1, handle: () => Promise.reject(new Error("synthetic failure")) })).rejects.toThrow("synthetic failure");
    expect(store.inbox.size).toBe(0);
  });
  it("cancels jobs and rechecks authoritative state before side effects", async () => {
    const store = new InMemoryEventingStore(); const core = createEventingCore(store); const cancelled = job(); await core.submitJob(cancelled); await core.cancelJob(cancelled.jobId, "synthetic cancellation reason");
    let effects = 0; const handler = { kind: "job" as const, messageType: cancelled.jobType, messageVersion: 1, recheckAuthoritativeState: () => Promise.resolve(true), handle: () => { effects++; return Promise.resolve(); } };
    await expect(core.consume({ attempt: 1, consumer: "platform.synthetic-worker", envelope: cancelled }, handler)).resolves.toMatchObject({ status: "skipped" });
    const rejected = job(); await core.submitJob(rejected);
    await expect(core.consume({ attempt: 1, consumer: "platform.synthetic-worker", envelope: rejected }, { ...handler, recheckAuthoritativeState: () => Promise.resolve(false) })).resolves.toEqual({ status: "skipped", reason: "authoritative_state_rejected" });
    expect(effects).toBe(0); expect(store.isolations.size).toBe(1);
  });
  it("aborts a timed-out Job and rolls processing state back to queued",async()=>{
    const store=new InMemoryEventingStore();const core=createEventingCore(store);const input={...job(),policy:{maxAttempts:1,backoffSeconds:[],timeoutMs:100,failureDisposition:"isolate"}};await core.submitJob(input);
    await expect(core.consume({attempt:1,consumer:"platform.synthetic-worker",envelope:input},{kind:"job",messageType:input.jobType,messageVersion:1,recheckAuthoritativeState:()=>Promise.resolve(true),handle:(_message,signal)=>new Promise((_resolve,reject)=>{signal.addEventListener("abort",()=>{reject(new Error("aborted"));},{once:true});})})).rejects.toMatchObject({code:"eventing_handler_timeout",retryable:true});
    expect(store.jobs.get(input.jobId)?.status).toBe("queued");expect(store.inbox.size).toBe(0);
  });
  it("does not release a timed-out transaction until a non-cooperative handler settles",async()=>{
    const store=new InMemoryEventingStore();const core=createEventingCore(store);const input={...job(),policy:{maxAttempts:1,backoffSeconds:[],timeoutMs:100,failureDisposition:"isolate" as const}};await core.submitJob(input);
    let release:()=>void=()=>undefined;const blocked=new Promise<void>((resolve)=>{release=()=>{resolve();};});let settled=false;
    const consumption=core.consume({attempt:1,consumer:"platform.synthetic-worker",envelope:input},{kind:"job",messageType:input.jobType,messageVersion:1,recheckAuthoritativeState:()=>Promise.resolve(true),handle:async()=>{await blocked;}}).finally(()=>{settled=true;});
    await new Promise((resolve)=>setTimeout(resolve,150));expect(settled).toBe(false);expect(store.jobs.get(input.jobId)?.status).toBe("processing");
    release();await expect(consumption).rejects.toMatchObject({code:"eventing_handler_timeout",retryable:true});expect(store.jobs.get(input.jobId)?.status).toBe("queued");
  });
  it("requires and enforces an explicit timeout for Event handlers",async()=>{
    const store=new InMemoryEventingStore();const core=createEventingCore(store);const input=event();const handler={kind:"event" as const,messageType:input.type,messageVersion:1,handle:(_message:unknown,signal:AbortSignal)=>new Promise<void>((_resolve,reject)=>{signal.addEventListener("abort",()=>{reject(new Error("aborted"));},{once:true});})};
    await expect(core.consume({attempt:1,consumer:"platform.synthetic-projection",envelope:input},handler)).rejects.toMatchObject({code:"eventing_invalid_input"});
    await expect(core.consume({attempt:1,consumer:"platform.synthetic-projection",envelope:input,timeoutMs:100},handler)).rejects.toMatchObject({code:"eventing_handler_timeout",retryable:true});expect(store.inbox.size).toBe(0);
  });
  it("does not report cancellation after a Job has atomically entered processing",async()=>{
    const store=new InMemoryEventingStore();const input=job();await createEventingCore(store).submitJob(input);await store.claimJob(input.jobId);
    await expect(createEventingCore(store).cancelJob(input.jobId,"synthetic cancellation race")).resolves.toMatchObject({status:"processing"});
  });
  it("emits bounded telemetry for duplicate Inbox hits without message payloads",async()=>{const observations:unknown[]=[];const store=new InMemoryEventingStore();const core=createEventingCore(store,{observer:{record:(item)=>{observations.push(item);}}});const input=event();const handler={kind:"event" as const,messageType:input.type,messageVersion:1,handle:()=>Promise.resolve()};await core.consume({attempt:1,consumer:"platform.synthetic-projection",envelope:input,timeoutMs:1000},handler);await core.consume({attempt:2,consumer:"platform.synthetic-projection",envelope:input,timeoutMs:1000},handler);expect(observations).toContainEqual(expect.objectContaining({operation:"consume",outcome:"duplicate"}));expect(JSON.stringify(observations)).not.toContain("synthetic-only");});
});

describe("Outbox publisher and operations", () => {
  it("retains committed Outbox while transport is unavailable and isolates after bounded attempts", async () => {
    const store = new InMemoryEventingStore(); await createEventingCore(store).appendEvent(event());
    let tick=new Date(at).getTime();const publisher = createOutboxPublisher(store, { publish: () => Promise.reject(new EventingError("eventing_storage_unavailable", true)) }, { batchSize: 10, claimLeaseSeconds: 30, maxAttempts: 2, backoffSeconds: [1], clock: () => new Date(tick+=60_000) });
    await expect(publisher.publishBatch()).resolves.toMatchObject({ retained: 1 });
    await expect(publisher.publishBatch()).resolves.toMatchObject({ isolated: 1 });
    expect([...store.outbox.values()][0]?.status).toBe("isolated");
  });
  it("safely republishes after Confirm succeeds but published-state update is lost", async () => {
    const store = new InMemoryEventingStore(); await createEventingCore(store).appendEvent(event()); const publish = vi.fn(() => Promise.resolve());
    let tick = new Date(at).getTime();
    const publisher = createOutboxPublisher(store, { publish }, { batchSize: 10, claimLeaseSeconds: 1, maxAttempts: 3, backoffSeconds: [1, 1], clock: () => new Date(tick += 60_000) });
    store.failPublishedUpdate = true; await expect(publisher.publishBatch()).rejects.toMatchObject({ code: "eventing_storage_unavailable", retryable: true });
    expect([...store.outbox.values()][0]?.status).toBe("publishing"); store.failPublishedUpdate = false;
    await expect(publisher.publishBatch()).resolves.toMatchObject({ published: 1 }); expect(publish).toHaveBeenCalledTimes(2);
  });
  it("surfaces a lost failure-state update instead of reporting a result that was not persisted", async () => {
    const store = new InMemoryEventingStore(); await createEventingCore(store).appendEvent(event());
    store.markOutboxFailure = () => Promise.resolve(false);
    const publisher = createOutboxPublisher(store, { publish: () => Promise.reject(new Error("offline")) }, { batchSize: 1, claimLeaseSeconds: 1, maxAttempts: 1, backoffSeconds: [] });
    await expect(publisher.publishBatch()).rejects.toMatchObject({ code: "eventing_storage_unavailable", retryable: true });
    expect([...store.outbox.values()][0]?.status).toBe("publishing");
  });
  it("requires authorization and audit before replay", async () => {
    const store = new InMemoryEventingStore(); const input = event(); await createEventingCore(store).appendEvent(input);
    const row = store.outbox.get(input.id); if (!row) throw new Error("fixture"); store.outbox.set(input.id, { ...row, status: "isolated", isolatedAt: new Date(at) });
    const sequence: string[] = []; const operations = createEventingOperations(store, { authorize: () => { sequence.push("authorize"); return Promise.resolve({ allowed: true, decisionId: "synthetic-decision" }); }, record: () => { sequence.push("audit"); return Promise.resolve(); } }, () => new Date(at));
    await operations.replayOutbox(input.id, "synthetic replay reason"); sequence.push(store.outbox.get(input.id)?.status ?? "missing"); expect(sequence).toEqual(["authorize", "audit", "pending"]);
  });
  it("denies replay without recording an audit intent or changing the isolated row",async()=>{const store=new InMemoryEventingStore();const input=event();await createEventingCore(store).appendEvent(input);const row=store.outbox.get(input.id);if(!row)throw new Error("fixture");store.outbox.set(input.id,{...row,status:"isolated",isolatedAt:new Date(at),lastErrorCode:"synthetic_terminal"});const record=vi.fn(()=>Promise.resolve());const replay=vi.spyOn(store,"replayOutbox");const operations=createEventingOperations(store,{authorize:()=>Promise.resolve({allowed:false,decisionId:"synthetic-denial"}),record});await expect(operations.replayOutbox(input.id,"synthetic replay reason")).rejects.toMatchObject({code:"eventing_operation_denied"});expect(record).not.toHaveBeenCalled();expect(replay).not.toHaveBeenCalled();expect(store.outbox.get(input.id)).toMatchObject({status:"isolated",attemptCount:0,lastErrorCode:"synthetic_terminal"});});
  it("keeps an isolated row unchanged when audit recording fails",async()=>{const store=new InMemoryEventingStore();const input=event();await createEventingCore(store).appendEvent(input);const row=store.outbox.get(input.id);if(!row)throw new Error("fixture");store.outbox.set(input.id,{...row,status:"isolated",isolatedAt:new Date(at),lastErrorCode:"synthetic_terminal"});const replay=vi.spyOn(store,"replayOutbox");const operations=createEventingOperations(store,{authorize:()=>Promise.resolve({allowed:true,decisionId:"synthetic-decision"}),record:()=>Promise.reject(new Error("synthetic audit unavailable"))});await expect(operations.replayOutbox(input.id,"synthetic replay reason")).rejects.toThrow("synthetic audit unavailable");expect(replay).not.toHaveBeenCalled();expect(store.outbox.get(input.id)).toMatchObject({status:"isolated",attemptCount:0,lastErrorCode:"synthetic_terminal"});});
  it("does not mutate pending or missing rows when replay finds no isolated record",async()=>{const store=new InMemoryEventingStore();const input=event();await createEventingCore(store).appendEvent(input);const record=vi.fn(()=>Promise.resolve());const operations=createEventingOperations(store,{authorize:()=>Promise.resolve({allowed:true,decisionId:"synthetic-decision"}),record},()=>new Date("2026-07-26T01:00:00.000Z"));await expect(operations.replayOutbox(input.id,"synthetic replay reason")).rejects.toMatchObject({code:"eventing_not_found"});expect(store.outbox.get(input.id)).toMatchObject({status:"pending",availableAt:new Date(at),attemptCount:0});const missing=randomUUID();await expect(operations.replayOutbox(missing,"synthetic replay reason")).rejects.toMatchObject({code:"eventing_not_found"});expect(store.outbox.has(missing)).toBe(false);expect(record).toHaveBeenCalledTimes(2);});
  it("reports isolated Outbox rows and missing durable facts for reconciliation",async()=>{const store=new InMemoryEventingStore();const input=event();await createEventingCore(store).appendEvent(input);const row=store.outbox.get(input.id);if(!row)throw new Error("fixture");store.outbox.set(input.id,{...row,status:"isolated"});const operations=createEventingOperations(store,{authorize:()=>Promise.resolve({allowed:true,decisionId:"synthetic"}),record:()=>Promise.resolve()});await expect(operations.backlog()).resolves.toMatchObject({isolatedCount:1});await expect(operations.reconcile({expectedOutboxMessageIds:[input.id,randomUUID()],expectedInbox:[{messageId:input.id,consumer:"platform.synthetic-projection"}]})).resolves.toMatchObject({isolatedOutboxMessageIds:[input.id],missingInbox:[{messageId:input.id,consumer:"platform.synthetic-projection"}]});});
});

describe("RabbitMQ boundary", () => {
  it("waits for publisher confirm and forwards bounded metadata", async () => {
    const calls: string[] = []; let properties: Readonly<Record<string, unknown>> | undefined;
    const channel: RabbitConfirmChannel = { assertDurableExchange: () => { calls.push("assert"); return Promise.resolve(); }, publishMandatory: (_e, _r, _p, value) => { calls.push("publish"); properties=value; return true; }, waitForDrain: () => Promise.resolve(), waitForConfirms: () => { calls.push("confirm"); return Promise.resolve(); }, takeReturned:()=>false };
    const transport=await createRabbitConfirmTransport(channel,{exchange:"ai-crm.synthetic",exchangeType:"topic",routes:[{messageKind:"event",messageType:"platform.synthetic.changed.v1",messageVersion:1,routingKey:"platform.synthetic.changed.v1"}]});
    await transport.publish({attempt:1,messageId:randomUUID(),messageKind:"event",messageType:"platform.synthetic.changed.v1",messageVersion:1,producer:"urn:ai-crm:walking-skeleton",correlationId:randomUUID(),payload:"{}"});
    expect(calls).toEqual(["assert","publish","confirm"]); expect(properties).toMatchObject({persistent:true,contentType:"application/json",headers:{"x-ai-crm-delivery-attempt":1,"x-ai-crm-publish-attempt":1}});
  });
  it("rejects a confirmed mandatory publication returned as unroutable", async()=>{
    const channel:RabbitConfirmChannel={assertDurableExchange:()=>Promise.resolve(),publishMandatory:()=>true,waitForDrain:()=>Promise.resolve(),waitForConfirms:()=>Promise.resolve(),takeReturned:()=>true};
    const transport=await createRabbitConfirmTransport(channel,{exchange:"ai-crm.synthetic",exchangeType:"direct",routes:[{messageKind:"event",messageType:"platform.synthetic.changed.v1",messageVersion:1,routingKey:"platform.synthetic.changed.v1"}]});
    await expect(transport.publish({attempt:1,messageId:randomUUID(),messageKind:"event",messageType:"platform.synthetic.changed.v1",messageVersion:1,producer:"urn:ai-crm:walking-skeleton",correlationId:randomUUID(),payload:"{}"})).rejects.toMatchObject({code:"eventing_storage_unavailable",retryable:true});
  });
  it("ACKs only after completion, confirms retry before ACK, and dead-letters terminal failures", async () => {
    const calls:string[]=[]; const delivery={body:Buffer.from(JSON.stringify(event())),attempt:1,ack:()=>calls.push("ack"),retry:()=>{calls.push("retry-confirm");return Promise.resolve();},deadLetter:()=>calls.push("dead-letter")};const options={eventPolicy:{maxAttempts:2,backoffSeconds:[1],timeoutMs:1000},classify:()=>"retryable" as const};
    await handleRabbitDelivery(delivery,()=>{calls.push("commit");return Promise.resolve();},options); expect(calls).toEqual(["commit","ack"]);
    calls.length=0; await handleRabbitDelivery(delivery,()=>Promise.reject(new Error("retry")),options); expect(calls).toEqual(["retry-confirm","ack"]);
    calls.length=0; await handleRabbitDelivery({...delivery,attempt:2},()=>Promise.reject(new Error("terminal")),options); expect(calls).toEqual(["dead-letter"]);
  });
  it("derives retry attempts and backoff from the validated Job contract",async()=>{let delay=0;const input=job();const delivery={body:Buffer.from(JSON.stringify(input)),attempt:2,ack:()=>undefined,retry:(seconds:number)=>{delay=seconds;return Promise.resolve();},deadLetter:()=>undefined};await handleRabbitDelivery(delivery,()=>Promise.reject(new Error("retry")),{eventPolicy:{maxAttempts:1,backoffSeconds:[],timeoutMs:1000},classify:()=>"retryable"});expect(delay).toBe(5);});
  it("dead-letters an over-budget delivery before invoking the consumer",async()=>{const calls:string[]=[];await handleRabbitDelivery({body:Buffer.from(JSON.stringify(event())),attempt:3,ack:()=>calls.push("ack"),retry:()=>Promise.resolve(),deadLetter:()=>calls.push("dead-letter")},()=>{calls.push("consume");return Promise.resolve();},{eventPolicy:{maxAttempts:2,backoffSeconds:[1],timeoutMs:1000},classify:()=>"retryable"});expect(calls).toEqual(["dead-letter"]);});
});
