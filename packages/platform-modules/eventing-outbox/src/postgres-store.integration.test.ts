import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseRuntime, runMigrations, type DatabaseRuntime } from "@ai-crm/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresEventingStore } from "./postgres-store.js";
import { createEventingCore } from "./service.js";

const urlFile = process.env.TEST_EVENTING_DATABASE_URL_FILE;
const suite = describe.skipIf(!urlFile);
let runtime: DatabaseRuntime;

suite("PostgreSQL Eventing store", () => {
  beforeAll(async () => {
    if (!urlFile) throw new Error("TEST_EVENTING_DATABASE_URL_FILE is required.");
    const connectionString = (await readFile(resolve(urlFile), "utf8")).trim();
    await runMigrations(connectionString, resolve(import.meta.dirname, "../../../database/migrations"));
    await runMigrations(connectionString, resolve(import.meta.dirname, "../migrations"));
    runtime=createDatabaseRuntime({applicationName:"asy01_integration",connectionString,connectionTimeoutMs:5000,idleTimeoutMs:10000,maxConnections:5,statementTimeoutMs:5000});
    await runtime.execute("create table platform_eventing_test_effects (message_id uuid primary key)");
  });

  afterAll(async () => {
    await runtime.close();
  });

  it("rolls back an Outbox append with its owning local transaction", async () => {
    const store=createPostgresEventingStore(runtime); const core=createEventingCore(store); const input=event();
    await expect(runtime.withTransaction(async()=>{await core.appendEvent(input);throw new Error("synthetic rollback");})).rejects.toThrow("synthetic rollback");
    expect((await runtime.execute("select * from platform_eventing.outbox_messages where message_id=$1",[input.id])).rowCount).toBe(0);
  });

  it("claims committed rows and durably deduplicates concurrent consumer effects", async () => {
    const store=createPostgresEventingStore(runtime); const core=createEventingCore(store); const input=event(); await runtime.withTransaction(()=>core.appendEvent(input));
    const claimed=await store.claimOutbox({at:new Date("2026-07-27T00:00:00.000Z"),staleBefore:new Date("2026-07-26T23:59:00.000Z"),limit:10,token:randomUUID}); expect(claimed).toHaveLength(1);
    expect(typeof claimed[0]?.payload).toBe("string"); expect(JSON.parse(claimed[0]?.payload ?? "null")).toMatchObject({ id: input.id });
    let enteredResolve:()=>void=()=>undefined;let releaseResolve:()=>void=()=>undefined;const entered=new Promise<void>((resolveEntered)=>{enteredResolve=resolveEntered;});const release=new Promise<void>((resolveRelease)=>{releaseResolve=resolveRelease;});
    let effects=0; const handler={kind:"event" as const,messageType:input.type,messageVersion:1,handle:async()=>{enteredResolve();await release;await runtime.execute("insert into platform_eventing_test_effects (message_id) values ($1)",[input.id]);effects++;}};
    const first=core.consume({attempt:1,consumer:"platform.synthetic-projection",envelope:input,timeoutMs:5000},handler);await entered;
    const duplicate=core.consume({attempt:2,consumer:"platform.synthetic-projection",envelope:input,timeoutMs:5000},handler);releaseResolve();
    await expect(first).resolves.toEqual({status:"completed"});await expect(duplicate).resolves.toEqual({status:"duplicate"});
    expect(effects).toBe(1); expect((await runtime.execute("select * from platform_eventing.inbox_receipts where message_id=$1",[input.id])).rowCount).toBe(1);
  });

  it("serializes cancellation against processing so cancellation cannot succeed before a committed side effect",async()=>{
    const store=createPostgresEventingStore(runtime);const core=createEventingCore(store);const input=job();await core.submitJob(input);
    let enteredResolve:()=>void=()=>undefined;let releaseResolve:()=>void=()=>undefined;const entered=new Promise<void>((resolveEntered)=>{enteredResolve=resolveEntered;});const release=new Promise<void>((resolveRelease)=>{releaseResolve=resolveRelease;});
    const consume=core.consume({attempt:1,consumer:"platform.synthetic-worker",envelope:input},{kind:"job",messageType:input.jobType,messageVersion:1,recheckAuthoritativeState:()=>Promise.resolve(true),handle:async()=>{enteredResolve();await release;await runtime.execute("insert into platform_eventing_test_effects (message_id) values ($1)",[input.jobId]);}});
    await entered;const cancellation=core.cancelJob(input.jobId,"synthetic concurrent cancellation");releaseResolve();
    await expect(consume).resolves.toEqual({status:"completed"});await expect(cancellation).resolves.toMatchObject({status:"completed"});
    expect((await runtime.execute("select * from platform_eventing_test_effects where message_id=$1",[input.jobId])).rowCount).toBe(1);
  });
});

const event=()=>({specversion:"1.0",id:randomUUID(),source:"urn:ai-crm:walking-skeleton",type:"platform.synthetic.changed.v1",time:"2026-07-26T00:00:00.000Z",datacontenttype:"application/json",dataschema:"urn:ai-crm:events:synthetic:changed:v1",correlationid:randomUUID(),data:{reference:"synthetic-only"}});
const job=()=>({jobId:randomUUID(),jobType:"platform.synthetic-check",jobVersion:1,source:"urn:ai-crm:walking-skeleton",idempotencyKey:`synthetic:${randomUUID()}`,requestedAt:"2026-07-26T00:00:00.000Z",correlationId:randomUUID(),policy:{maxAttempts:2,backoffSeconds:[1],timeoutMs:5000,failureDisposition:"isolate"},payload:{reference:"synthetic-only"}});
