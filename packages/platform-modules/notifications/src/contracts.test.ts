import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe,expect,it } from "vitest";
import type { NotificationIntent } from "./types.js";
describe("notification source contracts",()=>{
  it("validates the internal in-app HTTP surface",async()=>{await expect(SwaggerParser.validate(resolve(import.meta.dirname,"../../../../contracts/http/modules/notifications.openapi.yaml"))).resolves.toBeDefined();});
  it("validates the public business-neutral intent payload against the versioned source schema",async()=>{const schema=JSON.parse(await readFile(resolve(import.meta.dirname,"../../../../contracts/notifications/notification-intent.v1.schema.json"),"utf8")) as object;const validate=new Ajv2020({strict:true,validateFormats:false}).compile(schema);const valid={intentId:"00000000-0000-4000-8000-000000000031",producer:"module.synthetic",idempotencyKey:"intent-1",templateKey:"platform.synthetic.notice",templateVersion:1,selectors:[{selectorType:"principal",referenceId:"principal.synthetic"}],variables:{subject:"synthetic"},sourceType:"synthetic-resource",sourceId:"resource-1",deepLink:{applicationId:"workbench",routeId:"synthetic.detail",resourceType:"synthetic-resource",resourceId:"resource-1"}} satisfies NotificationIntent;expect("actor" in valid).toBe(false);expect(validate(valid),JSON.stringify(validate.errors)).toBe(true);expect(validate({producer:"module.synthetic",idempotencyKey:"intent-1",templateKey:"platform.synthetic.notice",templateVersion:1,selectors:[],variables:{},sourceType:"synthetic-resource",sourceId:"resource-1",deepLink:{applicationId:"https://untrusted.example",routeId:"x",resourceType:"x",resourceId:"x"}})).toBe(false);});
});
