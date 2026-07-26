import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createFormSchemaService, createMemoryFormSchemaStore } from "./index.js";

const actor = { actorId: "subject.synthetic", actorType: "authenticated_subject" as const };
const metadata = () => ({ actor, operationId: randomUUID(), reason: "synthetic denied lookup", traceId: "1234567890abcdef1234567890abcdef" });
const jsonSchema = { $schema: "https://json-schema.org/draft/2020-12/schema", additionalProperties: false, properties: { synthetic_value: { type: "string" } }, required: ["synthetic_value"], type: "object" };
const uiSchema = { fields: [{ component: "input" as const, field: "synthetic_value", order: 1 }], layout: "vertical" as const, version: 1 as const };

describe("form mutation authorization order", () => {
  it("denies before any resource lookup or existence decision", async () => {
    const store = createMemoryFormSchemaStore();
    const findDraft = vi.spyOn(store, "findDraft");
    const findRelease = vi.spyOn(store, "findRelease");
    const authorize = vi.fn(() => Promise.resolve({ allowed: false, decisionId: randomUUID() }));
    const audit = { record: vi.fn(() => Promise.resolve()) };
    const service = createFormSchemaService(store, { authorize }, audit);

    await expect(service.saveDraft({ ...metadata(), definitionId: "platform.synthetic.form", expectedRevision: 1, jsonSchema, ownerModule: "platform.synthetic", uiSchema })).rejects.toMatchObject({ code: "form_denied" });
    await expect(service.publish({ ...metadata(), definitionId: "platform.synthetic.form", expectedRevision: 1 })).rejects.toMatchObject({ code: "form_denied" });
    await expect(service.setReleaseActive({ ...metadata(), active: false, definitionId: "platform.synthetic.form", releaseVersion: 1 })).rejects.toMatchObject({ code: "form_denied" });

    expect(findDraft).not.toHaveBeenCalled();
    expect(findRelease).not.toHaveBeenCalled();
    expect(authorize).toHaveBeenCalledTimes(3);
    expect(audit.record).toHaveBeenCalledTimes(3);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ result: "denied" }));
  });
});
