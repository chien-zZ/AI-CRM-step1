import { randomUUID } from "node:crypto";
import type { DatabaseQueryResult } from "@ai-crm/database";
import { describe,expect,it,vi } from "vitest";
import { createPostgresTaskCenterStore,type TaskCenterPersistenceRuntime } from "./postgres-store.js";
import type { TaskLifecycleEvent } from "./types.js";

const event=():TaskLifecycleEvent=>({
  eventId:randomUUID(),
  sourceType:"workflow",
  sourceTaskId:"task.synthetic",
  sourceVersion:1,
  occurredAt:"2026-07-26T00:00:00.000Z",
  status:"open",
  deepLink:{appId:"workbench",routeId:"task-detail"},
});
const result=<Row>(rows:readonly unknown[]=[]):DatabaseQueryResult<Row>=>({rowCount:rows.length,rows:rows as readonly Row[]});

describe("PostgresTaskCenterStore cancellation",()=>{
  it("uses a transport-safe composite cursor instead of PostgreSQL NUL text",async()=>{const calls:{sql:string;values:readonly unknown[]|undefined}[]=[];const rows=[{projection_id:"projection.synthetic",source_type:"workflow:synthetic",source_task_id:"task:synthetic",source_version:1,status:"open",app_id:"workbench",route_id:"task-detail",assignee_reference:null,candidate_scope_reference:null,due_at:null,created_at:"2026-07-26T00:00:00.000Z",updated_at:"2026-07-26T00:00:00.000Z"}];const runtime:TaskCenterPersistenceRuntime={abortSignalSupport:true,execute:<Row>(sql:string,values?:readonly unknown[])=>{calls.push({sql,values});return Promise.resolve(result<Row>(calls.length===1?[...rows,...rows]:rows));},withTransaction:async work=>work()};const store=createPostgresTaskCenterStore(runtime);const first=await store.list({limit:1});expect(first.nextCursor).toBeDefined();const nextCursor=first.nextCursor;if(nextCursor===undefined)throw new Error("expected next cursor");await store.list({limit:1,cursor:nextCursor});expect(calls[0]?.sql).not.toContain("chr(0)");expect(calls[1]?.values?.slice(1,3)).toEqual(["workflow:synthetic","task:synthetic"]);});
  it("fails closed when the persistence runtime does not advertise cancellation",()=>{const runtime={execute:vi.fn(),withTransaction:vi.fn()};expect(()=>createPostgresTaskCenterStore(runtime)).toThrow();});
  it("does not acquire a transaction for an already aborted apply",async()=>{
    const withTransaction=vi.fn();
    const runtime={abortSignalSupport:true as const,execute:vi.fn(),withTransaction} satisfies TaskCenterPersistenceRuntime;
    const controller=new AbortController();
    controller.abort(new Error("deadline exceeded"));

    await expect(createPostgresTaskCenterStore(runtime).apply(event(),controller.signal)).rejects.toThrow("deadline exceeded");
    expect(withTransaction).not.toHaveBeenCalled();
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  it("propagates one signal to the transaction and every statement",async()=>{
    const signals:AbortSignal[]=[];
    let projectionReads=0;
    const execute=async<Row = Record<string,unknown>>(sql:string,_values?:readonly unknown[],signal?:AbortSignal):Promise<DatabaseQueryResult<Row>>=>{
      await Promise.resolve();
      if(signal)signals.push(signal);
      if(sql.includes("projection_events where"))return result<Row>();
      if(sql.startsWith("select * from platform_task_center.task_projections")){
        projectionReads+=1;
        const rows=projectionReads===1?[]:[{projection_id:"projection.synthetic",source_type:"workflow",source_task_id:"task.synthetic",source_version:1,status:"open",app_id:"workbench",route_id:"task-detail",assignee_reference:null,candidate_scope_reference:null,due_at:null,created_at:"2026-07-26T00:00:00.000Z",updated_at:"2026-07-26T00:00:00.000Z"}];
        return result<Row>(rows);
      }
      return{rowCount:1,rows:[]};
    };
    const transactionSignals:AbortSignal[]=[];
    const runtime:TaskCenterPersistenceRuntime={abortSignalSupport:true,execute,withTransaction:async(work,signal)=>{if(signal)transactionSignals.push(signal);return work();}};
    const controller=new AbortController();

    await expect(createPostgresTaskCenterStore(runtime).apply(event(),controller.signal)).resolves.toMatchObject({status:"applied"});
    expect(transactionSignals).toEqual([controller.signal]);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal)=>signal===controller.signal)).toBe(true);
  });

  it("settles the cancelled statement and rolls back before release without late SQL or commit",async()=>{
    const statements:string[]=[];
    const lifecycle:string[]=[];
    const controller=new AbortController();
    const runtime:TaskCenterPersistenceRuntime={
      abortSignalSupport:true,
      execute:async<Row = Record<string,unknown>>(sql:string,_values?:readonly unknown[],signal?:AbortSignal):Promise<DatabaseQueryResult<Row>>=>{
        statements.push(sql);
        if(statements.length===1)return{rowCount:1,rows:[]};
        await new Promise<void>((_resolve,reject)=>signal?.addEventListener("abort",()=>{lifecycle.push("query-settled");reject(signal.reason instanceof Error?signal.reason:new Error("aborted"));},{once:true}));
        return result<Row>();
      },
      withTransaction:async(work,signal)=>{
        signal?.throwIfAborted();
        lifecycle.push("begin");
        try{
          const result=await work();
          signal?.throwIfAborted();
          lifecycle.push("commit");
          return result;
        }catch(error){
          lifecycle.push("rollback");
          throw error;
        }finally{
          lifecycle.push("release");
        }
      },
    };

    const pending=createPostgresTaskCenterStore(runtime).apply(event(),controller.signal);
    await vi.waitFor(()=>{expect(statements).toHaveLength(2);});
    controller.abort(new Error("deadline exceeded"));

    await expect(pending).rejects.toThrow("deadline exceeded");
    expect(statements).toHaveLength(2);
    expect(lifecycle).toEqual(["begin","query-settled","rollback","release"]);
  });
});
