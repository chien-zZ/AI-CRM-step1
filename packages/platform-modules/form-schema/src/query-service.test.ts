import { describe, expect, it, vi } from "vitest";
import { createPostgresFormSchemaQueryService, type FormPersistenceRuntime, type FormQueryContext } from "./index.js";

const person = "10000000-0000-4000-8000-000000000001";
const assignment = "20000000-0000-4000-8000-000000000001";
const requestContext: FormQueryContext = { actor: { actorId: "subject:synthetic", actorType: "authenticated_subject", assignmentId: assignment }, subject: { activeAssignmentIds: [assignment], selectedAssignmentId: assignment, workforcePersonId: person }, traceId: "1234567890abcdef1234567890abcdef" };
const release = { active: true, content_digest: "a".repeat(64), definition_id: "platform.synthetic.form", json_schema: { $schema: "https://json-schema.org/draft/2020-12/schema", additionalProperties: false, properties: { synthetic_value: { type: "string" } }, required: ["synthetic_value"], type: "object" }, owner_module: "platform.synthetic", published_at: "2026-07-28T00:00:00.000Z", release_version: 1, ui_schema: { fields: [{ component: "input", field: "synthetic_value", order: 1 }], layout: "vertical", version: 1 } };
function runtime(): FormPersistenceRuntime {
  const execute: FormPersistenceRuntime["execute"] = vi.fn(() => Promise.resolve({ rowCount: 1, rows: [release] } as never));
  return { execute, withTransaction: (work) => work() };
}

describe("createPostgresFormSchemaQueryService", () => {
  it("authorizes an exact release with the explicit subject before PostgreSQL", async () => {
    const db = runtime();
    const authorize = vi.fn(() => Promise.resolve({ allowed: true, decisionId: "30000000-0000-4000-8000-000000000001" }));
    const service = createPostgresFormSchemaQueryService(db, { authorize });
    await expect(service.getRelease({ context: requestContext, definitionId: "platform.synthetic.form", releaseVersion: 1 })).resolves.toMatchObject({ releaseVersion: 1 });
    expect(authorize).toHaveBeenCalledWith({ action: "read", actor: requestContext.actor, definitionId: "platform.synthetic.form", permission: { action: "read", code: "platform.form-schema.form-release:read", resource: "platform.form-schema.form-release" }, releaseVersion: 1, subject: requestContext.subject, traceId: requestContext.traceId });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("validates against the exact immutable release without persisting data", async () => {
    const service = createPostgresFormSchemaQueryService(runtime(), { authorize: () => Promise.resolve({ allowed: true, decisionId: "30000000-0000-4000-8000-000000000001" }) });
    await expect(service.validateSubmission({ context: requestContext, data: { synthetic_value: "ok" }, definitionId: "platform.synthetic.form", releaseVersion: 1 })).resolves.toMatchObject({ valid: true });
    await expect(service.validateSubmission({ context: requestContext, data: {}, definitionId: "platform.synthetic.form", releaseVersion: 1 })).resolves.toMatchObject({ valid: false });
  });
  it("does not accept an inactive release for new validation",async()=>{const execute:FormPersistenceRuntime["execute"]=vi.fn(()=>Promise.resolve({rowCount:1,rows:[{...release,active:false}]} as never));const service=createPostgresFormSchemaQueryService({execute,withTransaction:work=>work()},{authorize:()=>Promise.resolve({allowed:true,decisionId:"30000000-0000-4000-8000-000000000001"})});await expect(service.validateSubmission({context:requestContext,data:{synthetic_value:"blocked"},definitionId:"platform.synthetic.form",releaseVersion:1})).rejects.toMatchObject({code:"form_not_found"});});

  it("fails denial and contradictory assignment context before PostgreSQL", async () => {
    const deniedDb = runtime();
    const denied = createPostgresFormSchemaQueryService(deniedDb, { authorize: () => Promise.resolve({ allowed: false, decisionId: "30000000-0000-4000-8000-000000000001" }) });
    await expect(denied.getRelease({ context: requestContext, definitionId: "platform.synthetic.form", releaseVersion: 1 })).rejects.toMatchObject({ code: "form_denied" });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(deniedDb.execute).not.toHaveBeenCalled();
    const invalidDb = runtime();
    const invalid = createPostgresFormSchemaQueryService(invalidDb, { authorize: vi.fn() });
    await expect(invalid.getRelease({ context: { ...requestContext, subject: { ...requestContext.subject, activeAssignmentIds: [] } }, definitionId: "platform.synthetic.form", releaseVersion: 1 })).rejects.toMatchObject({ code: "form_invalid_input" });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(invalidDb.execute).not.toHaveBeenCalled();
  });

  it("rejects accessor-backed request context without invoking it", async () => {
    let reads = 0;
    const context = Object.defineProperty({ subject: requestContext.subject, traceId: requestContext.traceId }, "actor", {
      enumerable: true,
      get: () => {
        reads += 1;
        return requestContext.actor;
      },
    }) as FormQueryContext;
    const db = runtime();
    const service = createPostgresFormSchemaQueryService(db, { authorize: vi.fn() });

    await expect(service.getRelease({ context, definitionId: "platform.synthetic.form", releaseVersion: 1 }))
      .rejects.toMatchObject({ code: "form_invalid_input" });
    expect(reads).toBe(0);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("rejects nested actor and assignment accessors without invoking them", async () => {
    const db = runtime();
    const service = createPostgresFormSchemaQueryService(db, { authorize: vi.fn() });
    let reads = 0;
    const actor = Object.defineProperty({ actorType: "authenticated_subject", assignmentId: assignment }, "actorId", {
      enumerable: true, get: () => { reads += 1; return "subject:synthetic"; },
    });
    await expect(service.getRelease({ context: { ...requestContext, actor } as FormQueryContext, definitionId: "platform.synthetic.form", releaseVersion: 1 }))
      .rejects.toMatchObject({ code: "form_invalid_input" });

    const assignments = [assignment];
    Object.defineProperty(assignments, "0", { enumerable: true, get: () => { reads += 1; return assignment; } });
    await expect(service.getRelease({ context: { ...requestContext, subject: { ...requestContext.subject, activeAssignmentIds: assignments } }, definitionId: "platform.synthetic.form", releaseVersion: 1 }))
      .rejects.toMatchObject({ code: "form_invalid_input" });
    expect(reads).toBe(0);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(db.execute).not.toHaveBeenCalled();
  });
});
