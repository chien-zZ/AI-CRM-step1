import { createHash } from "node:crypto";
import { WorkflowError } from "./errors.js";
import type { WorkflowActor, WorkflowVariable, WorkflowVariableKind, WorkflowVariablePolicy } from "./types.js";

const SAFE_REFERENCE=/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,254}$/u;
const SAFE_KEY=/^[a-z][A-Za-z0-9._-]{0,127}$/u;
const TRACEPARENT=/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/u;
const hasControl=(value:string):boolean=>{for(let index=0;index<value.length;index+=1){const code=value.charCodeAt(index);if(code<32||code===127)return true;}return false;};
export const validateBounded=(value:string,maximum:number):string=>{if(value.length<1||value.length>maximum||hasControl(value))throw new WorkflowError("WORKFLOW_INVALID_INPUT");return value;};
export const validateKey=(value:string):string=>{if(!SAFE_KEY.test(value))throw new WorkflowError("WORKFLOW_INVALID_INPUT");return value;};
export const validateReference=(value:string):string=>{if(!SAFE_REFERENCE.test(value))throw new WorkflowError("WORKFLOW_INVALID_INPUT");return value;};
export const validateActor=(actor:WorkflowActor):WorkflowActor=>{validateReference(actor.principalId);return actor;};
export const validateIdempotencyKey=validateReference;
export const validateVersion=(value:number):number=>{if(!Number.isSafeInteger(value)||value<1)throw new WorkflowError("WORKFLOW_INVALID_INPUT");return value;};
export const validateTraceparent=(value:string|undefined):string|undefined=>{if(value!==undefined&&!TRACEPARENT.test(value))throw new WorkflowError("WORKFLOW_INVALID_INPUT");return value;};
const validateVariable=(value:WorkflowVariable,kind:WorkflowVariableKind):void=>{if(kind==="boolean"&&typeof value!=="boolean")throw new WorkflowError("WORKFLOW_INVALID_INPUT");if(kind==="number"&&(typeof value!=="number"||!Number.isFinite(value)))throw new WorkflowError("WORKFLOW_INVALID_INPUT");if(kind==="reference"&&(typeof value!=="string"||!SAFE_REFERENCE.test(value)))throw new WorkflowError("WORKFLOW_INVALID_INPUT");if(kind==="string"&&(typeof value!=="string"||(value.length>512)||hasControl(value)))throw new WorkflowError("WORKFLOW_INVALID_INPUT");};
export const validateVariables=(policy:WorkflowVariablePolicy,definitionKey:string,variables:Readonly<Record<string,WorkflowVariable>>):Readonly<Record<string,WorkflowVariable>>=>{if(!Object.hasOwn(policy.definitions,definitionKey))throw new WorkflowError("WORKFLOW_INVALID_INPUT");const rules=policy.definitions[definitionKey];if(rules===undefined||Object.keys(variables).length>32)throw new WorkflowError("WORKFLOW_INVALID_INPUT");for(const[name,value]of Object.entries(variables)){if(!Object.hasOwn(rules,name))throw new WorkflowError("WORKFLOW_INVALID_INPUT");const kind=rules[name];if(kind===undefined)throw new WorkflowError("WORKFLOW_INVALID_INPUT");validateVariable(value,kind);}return Object.freeze({...variables});};
const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value!==null&&typeof value==="object"?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)])):value;
export const fingerprint=(value:unknown):string=>createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
