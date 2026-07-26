import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const port=Number(process.env.AI_CRM_TEST_FLOWABLE_PORT??"58082");
if(!Number.isSafeInteger(port)||port<1024||port>65535)throw new Error("Invalid Flowable integration test port.");
await new Promise((ready,reject)=>{const server=createServer();server.once("error",()=>reject(new Error(`Integration test port ${String(port)} is unavailable.`)));server.listen(port,"127.0.0.1",()=>server.close(ready));});
const secrets=await mkdtemp(resolve(tmpdir(),"ai-crm-prc01-"));const project=`ai-crm-test-prc01-${randomUUID().slice(0,8)}`;const pnpmCli=process.env.npm_execpath;if(!pnpmCli)throw new Error("pnpm CLI path is unavailable.");
const environment={...process.env,AI_CRM_COMPOSE_SECRET_DIR:secrets,AI_CRM_TEST_FLOWABLE_PORT:String(port),TEST_FLOWABLE_BASE_URL:`http://127.0.0.1:${String(port)}/flowable-rest/service/`,TEST_FLOWABLE_PASSWORD_FILE:resolve(secrets,"flowable_admin_password")};
const compose=["compose","-p",project,"-f","deploy/compose/compose.base.yml","-f","deploy/flowable/compose.integration.yml"];
const run=(command,args)=>{const result=spawnSync(command,args,{cwd:resolve(import.meta.dirname,"../../../.."),env:environment,shell:false,stdio:"inherit"});if(result.status!==0)throw new Error(`${command} ${String(args[0]??"")} failed.`);};
try{run(process.execPath,["scripts/bootstrap/compose-secrets.mjs","test"]);run("docker",[...compose,"up","-d","--wait","flowable"]);run(process.execPath,[pnpmCli,"--filter","@ai-crm/platform-workflow","exec","vitest","run","--config","../../../vitest.config.ts","src/runtime.integration.test.ts"]);}finally{spawnSync("docker",[...compose,"down","--volumes","--remove-orphans"],{cwd:resolve(import.meta.dirname,"../../../.."),env:environment,shell:false,stdio:"inherit"});await rm(secrets,{force:true,recursive:true});}
