import { readFile } from "node:fs/promises";
import { describe,expect,it } from "vitest";
import { createFlowableRestEngine } from "./flowable-rest.js";

const baseUrl=process.env.TEST_FLOWABLE_BASE_URL;
const passwordFile=process.env.TEST_FLOWABLE_PASSWORD_FILE;
const suite=describe.skipIf(baseUrl===undefined||passwordFile===undefined);
const asError=(value:unknown):Error=>value instanceof Error?value:new Error("Non-Error integration failure.");

suite("Flowable REST runtime",()=>{it("deploys, starts, operates human tasks, completes, cancels and queries history",async()=>{
  if(baseUrl===undefined||passwordFile===undefined)throw new Error("Flowable integration configuration is required.");
  const password=(await readFile(passwordFile,"utf8")).trim();
  const engine=createFlowableRestEngine({baseUrl,password,timeoutMs:10_000,username:"dev_flowable_admin"});
  const xml=await readFile(new URL("../../../../deploy/flowable/bpmn/synthetic-human-task.v1.bpmn20.xml",import.meta.url),"utf8");
  let deploymentId:string|undefined;let primaryError:Error|undefined;
  try{
    const definition=await engine.deployDefinition({assetName:`synthetic-human-task-${String(Date.now())}.bpmn20.xml`,bpmnXml:xml,definitionKey:"syntheticHumanTaskV1"});deploymentId=definition.deploymentId;
    await expect(engine.getDefinition(definition.key,definition.version)).resolves.toEqual(definition);
    const completed=await engine.startProcess({businessKey:`integration-complete-${String(Date.now())}`,definition,variables:{}});const [task]=await engine.listTasks(completed.processInstanceId);if(task===undefined)throw new Error("Synthetic BPMN did not create a human task.");
    await expect(engine.claimTask(task.taskId,"synthetic-subject-1")).resolves.toMatchObject({assigneeReference:"synthetic-subject-1",status:"active"});await expect(engine.releaseTask(task.taskId)).resolves.toMatchObject({status:"active"});await engine.claimTask(task.taskId,"synthetic-subject-1");await expect(engine.completeTask(task.taskId,{})).resolves.toMatchObject({status:"completed"});await expect(engine.getInstance(completed.processInstanceId)).resolves.toMatchObject({status:"completed"});
    const cancelled=await engine.startProcess({businessKey:`integration-cancel-${String(Date.now())}`,definition,variables:{}});await engine.cancelProcess(cancelled.processInstanceId,"synthetic integration cleanup");await expect(engine.getInstance(cancelled.processInstanceId)).resolves.toMatchObject({status:"cancelled"});await expect(engine.getDefinition(definition.key,definition.version+10_000)).rejects.toMatchObject({code:"WORKFLOW_UNKNOWN_DEFINITION_VERSION"});
  }catch(error){primaryError=asError(error);}
  let cleanupError:Error|undefined;
  if(deploymentId!==undefined){try{const headers=new Headers({authorization:`Basic ${Buffer.from(`dev_flowable_admin:${password}`,"utf8").toString("base64")}`});const response=await fetch(new URL(`repository/deployments/${encodeURIComponent(deploymentId)}?cascade=true`,baseUrl),{headers,method:"DELETE",signal:AbortSignal.timeout(10_000)});if(!response.ok)throw new Error(`Synthetic Flowable deployment cleanup failed with HTTP ${String(response.status)}.`);}catch(error){cleanupError=asError(error);}}
  if(primaryError!==undefined&&cleanupError!==undefined)throw new AggregateError([primaryError,cleanupError],"Flowable integration and cleanup failed.");if(primaryError!==undefined)throw primaryError;if(cleanupError!==undefined)throw cleanupError;
},30_000);});
