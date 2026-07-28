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
});
