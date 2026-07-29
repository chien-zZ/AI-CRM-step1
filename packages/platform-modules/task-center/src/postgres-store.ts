import type { DatabaseQueryResult } from "@ai-crm/database";
import { TaskCenterError } from "./errors.js";
import { fingerprint } from "./validation.js";
import type { ProjectionApplyResult, TaskCenterStore, TaskCommandClaim, TaskCommandResult, TaskLifecycleEvent, TaskPage, TaskProjection, TaskProjectionKey, TaskProjectionStatus } from "./types.js";

export interface TaskCenterPersistenceRuntime {
  readonly abortSignalSupport: true;
  execute<Row = Record<string, unknown>>(sql: string, values?: readonly unknown[], signal?: AbortSignal): Promise<DatabaseQueryResult<Row>>;
  withTransaction<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}
interface TaskCenterPersistenceRuntimeCandidate {
  readonly abortSignalSupport?: true;
  execute<Row = Record<string, unknown>>(sql: string, values?: readonly unknown[], signal?: AbortSignal): Promise<DatabaseQueryResult<Row>>;
  withTransaction<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}
const supportsAbortSignals=(runtime:TaskCenterPersistenceRuntimeCandidate):runtime is TaskCenterPersistenceRuntime=>runtime.abortSignalSupport===true;

interface ProjectionRow { projection_id:string;source_type:string;source_task_id:string;source_version:number;status:TaskProjectionStatus;app_id:string;route_id:string;assignee_reference:string|null;candidate_scope_reference:string|null;due_at:Date|string|null;created_at:Date|string;updated_at:Date|string }
interface CommandRow { fingerprint:string;status:"accepted"|"running";source_command_id:string|null;command_lease_token:string|null;command_lease_expires_at:Date|string|null }
const iso=(value:Date|string):string=>value instanceof Date?value.toISOString():new Date(value).toISOString();
const map=(row:ProjectionRow):TaskProjection=>({projectionId:row.projection_id,sourceType:row.source_type,sourceTaskId:row.source_task_id,sourceVersion:row.source_version,status:row.status,deepLink:{appId:row.app_id,routeId:row.route_id},createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),...(row.assignee_reference===null?{}:{assigneeReference:row.assignee_reference}),...(row.candidate_scope_reference===null?{}:{candidateScopeReference:row.candidate_scope_reference}),...(row.due_at===null?{}:{dueAt:iso(row.due_at)})});
const decodeCursor=(value:string|undefined):readonly [string|null,string|null]=>{if(value===undefined)return[null,null];try{const parsed=JSON.parse(Buffer.from(value,"base64url").toString("utf8")) as unknown;if(!Array.isArray(parsed)||parsed.length!==2||parsed.some(item=>typeof item!=="string"))throw new Error("invalid");return[parsed[0] as string,parsed[1] as string];}catch{throw new TaskCenterError("TASK_INPUT_INVALID");}};
const encodeCursor=(sourceType:string,sourceTaskId:string):string=>Buffer.from(JSON.stringify([sourceType,sourceTaskId]),"utf8").toString("base64url");

class PostgresTaskCenterStore implements TaskCenterStore {
  public constructor(private readonly db:TaskCenterPersistenceRuntime){}

  private async execute<Row = Record<string, unknown>>(sql:string,values:readonly unknown[]|undefined,signal?:AbortSignal):Promise<DatabaseQueryResult<Row>>{
    signal?.throwIfAborted();
    const result=await this.db.execute<Row>(sql,values,signal);
    signal?.throwIfAborted();
    return result;
  }

  private async readProjection(key:TaskProjectionKey,signal?:AbortSignal):Promise<TaskProjection|undefined>{
    const result=await this.execute<ProjectionRow>("select * from platform_task_center.task_projections where source_type=$1 and source_task_id=$2",[key.sourceType,key.sourceTaskId],signal);
    return result.rows[0]?map(result.rows[0]):undefined;
  }

  public async apply(event:TaskLifecycleEvent,signal?:AbortSignal):Promise<ProjectionApplyResult>{
    signal?.throwIfAborted();
    return await this.db.withTransaction(async()=>{
      await this.execute("select pg_advisory_xact_lock(hashtextextended($1,0))",[`${event.sourceType}:${event.sourceTaskId}`],signal);
      const eventHash=fingerprint(event);
      const receipt=await this.execute<{payload_sha256:string}>("select payload_sha256 from platform_task_center.projection_events where event_id=$1",[event.eventId],signal);
      if(receipt.rows[0]){
        if(receipt.rows[0].payload_sha256!==eventHash)throw new TaskCenterError("TASK_COMMAND_CONFLICT");
        const projection=await this.readProjection(event,signal);
        if(!projection)throw new TaskCenterError("TASK_STORAGE_UNAVAILABLE",{retryable:true});
        return{status:"duplicate",projection};
      }
      const current=await this.readProjection(event,signal);
      if(!current||event.sourceVersion>current.sourceVersion){
        await this.execute(`insert into platform_task_center.task_projections (projection_id,source_type,source_task_id,source_version,status,app_id,route_id,assignee_reference,candidate_scope_reference,due_at,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) on conflict (source_type,source_task_id) do update set source_version=excluded.source_version,status=excluded.status,app_id=excluded.app_id,route_id=excluded.route_id,assignee_reference=excluded.assignee_reference,candidate_scope_reference=excluded.candidate_scope_reference,due_at=excluded.due_at,updated_at=excluded.updated_at`,[current?.projectionId??event.eventId,event.sourceType,event.sourceTaskId,event.sourceVersion,event.status,event.deepLink.appId,event.deepLink.routeId,event.assigneeReference??null,event.candidateScopeReference??null,event.dueAt??null,event.occurredAt],signal);
      }
      await this.execute("insert into platform_task_center.projection_events (event_id,source_type,source_task_id,source_version,payload_sha256,processed_at) values ($1,$2,$3,$4,$5,now())",[event.eventId,event.sourceType,event.sourceTaskId,event.sourceVersion,eventHash],signal);
      const projection=await this.readProjection(event,signal);
      if(!projection)throw new TaskCenterError("TASK_STORAGE_UNAVAILABLE",{retryable:true});
      return{status:current&&event.sourceVersion<=current.sourceVersion?"stale":"applied",projection};
    },signal);
  }

  public reconcile(event:TaskLifecycleEvent):Promise<ProjectionApplyResult>{return this.db.withTransaction(async()=>{await this.db.execute("select pg_advisory_xact_lock(hashtextextended($1,0))",[`${event.sourceType}:${event.sourceTaskId}`]);const eventHash=fingerprint(event);const receipt=await this.db.execute<{payload_sha256:string}>("select payload_sha256 from platform_task_center.projection_events where event_id=$1",[event.eventId]);if(receipt.rows[0]&&receipt.rows[0].payload_sha256!==eventHash)throw new TaskCenterError("TASK_COMMAND_CONFLICT");const current=await this.get(event);if(current&&event.sourceVersion<current.sourceVersion)return{status:"stale",projection:current};const unchanged=current!==undefined&&current.sourceVersion===event.sourceVersion&&current.status===event.status&&current.deepLink.appId===event.deepLink.appId&&current.deepLink.routeId===event.deepLink.routeId&&current.assigneeReference===event.assigneeReference&&current.candidateScopeReference===event.candidateScopeReference&&current.dueAt===event.dueAt;await this.db.execute(`insert into platform_task_center.task_projections (projection_id,source_type,source_task_id,source_version,status,app_id,route_id,assignee_reference,candidate_scope_reference,due_at,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) on conflict (source_type,source_task_id) do update set source_version=excluded.source_version,status=excluded.status,app_id=excluded.app_id,route_id=excluded.route_id,assignee_reference=excluded.assignee_reference,candidate_scope_reference=excluded.candidate_scope_reference,due_at=excluded.due_at,updated_at=excluded.updated_at`,[current?.projectionId??event.eventId,event.sourceType,event.sourceTaskId,event.sourceVersion,event.status,event.deepLink.appId,event.deepLink.routeId,event.assigneeReference??null,event.candidateScopeReference??null,event.dueAt??null,event.occurredAt]);await this.db.execute("insert into platform_task_center.projection_events (event_id,source_type,source_task_id,source_version,payload_sha256,processed_at) values ($1,$2,$3,$4,$5,now()) on conflict (event_id) do nothing",[event.eventId,event.sourceType,event.sourceTaskId,event.sourceVersion,eventHash]);const projection=await this.get(event);if(!projection)throw new TaskCenterError("TASK_STORAGE_UNAVAILABLE",{retryable:true});return{status:unchanged?"duplicate":"applied",projection};});}
  public get(key:TaskProjectionKey):Promise<TaskProjection|undefined>{return this.readProjection(key);}
  public async list(input:{status?:TaskProjectionStatus;limit:number;cursor?:string}):Promise<TaskPage>{const[cursorSource,cursorTask]=decodeCursor(input.cursor);const result=await this.db.execute<ProjectionRow>(`select * from platform_task_center.task_projections where ($1::text is null or status=$1) and ($2::text is null or (source_type,source_task_id) > ($2,$3)) order by source_type,source_task_id limit $4`,[input.status??null,cursorSource,cursorTask,input.limit+1]);const items=result.rows.slice(0,input.limit).map(map);const last=items.at(-1);return{items,...(result.rows.length>input.limit&&last?{nextCursor:encodeCursor(last.sourceType,last.sourceTaskId)}:{})};}
  public async claimCommand(input:{idempotencyKey:string;fingerprint:string;leaseToken:string;now:Date;leaseExpiresAt:Date}):Promise<TaskCommandClaim>{const claimed=await this.db.execute<CommandRow>(`insert into platform_task_center.task_commands (idempotency_key,fingerprint,status,command_lease_token,command_lease_expires_at,created_at,updated_at) values ($1,$2,'running',$3,$4,$5,$5) on conflict (idempotency_key) do update set command_lease_token=excluded.command_lease_token,command_lease_expires_at=excluded.command_lease_expires_at,updated_at=excluded.updated_at where platform_task_center.task_commands.status='running' and platform_task_center.task_commands.fingerprint=excluded.fingerprint and platform_task_center.task_commands.command_lease_expires_at <= excluded.updated_at returning *`,[input.idempotencyKey,input.fingerprint,input.leaseToken,input.leaseExpiresAt,input.now]);if(claimed.rows[0])return{status:"claimed",leaseToken:input.leaseToken};const existing=await this.db.execute<CommandRow>("select * from platform_task_center.task_commands where idempotency_key=$1",[input.idempotencyKey]);const row=existing.rows[0];if(!row)throw new TaskCenterError("TASK_STORAGE_UNAVAILABLE",{retryable:true});if(row.fingerprint!==input.fingerprint)throw new TaskCenterError("TASK_COMMAND_CONFLICT");if(row.status==="accepted"&&row.source_command_id!==null)return{status:"accepted",result:{sourceCommandId:row.source_command_id,status:"accepted"}};return{status:"running"};}
  public async acceptCommand(input:{idempotencyKey:string;leaseToken:string;result:TaskCommandResult}):Promise<boolean>{const updated=await this.db.execute("update platform_task_center.task_commands set status='accepted',source_command_id=$3,command_lease_token=null,command_lease_expires_at=null,updated_at=now() where idempotency_key=$1 and status='running' and command_lease_token=$2",[input.idempotencyKey,input.leaseToken,input.result.sourceCommandId]);return updated.rowCount===1;}
  public async releaseCommand(input:{idempotencyKey:string;leaseToken:string}):Promise<void>{await this.db.execute("delete from platform_task_center.task_commands where idempotency_key=$1 and status='running' and command_lease_token=$2",[input.idempotencyKey,input.leaseToken]);}
}
export const createPostgresTaskCenterStore=(runtime:TaskCenterPersistenceRuntimeCandidate):TaskCenterStore=>{
  if(!supportsAbortSignals(runtime))throw new TaskCenterError("TASK_STORAGE_UNAVAILABLE",{retryable:false});
  return new PostgresTaskCenterStore(runtime);
};
