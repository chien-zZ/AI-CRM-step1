import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it, vi } from "vitest";
import { createFlowableRestEngine } from "./flowable-rest.js";

describe("workflow lifecycle contract compatibility", () => {
  it("validates adapter-normalized task lifecycle data against the published schema", async () => {
    const schema = JSON.parse(await readFile(new URL("../../../../contracts/events/workflow-task-lifecycle.v1.schema.json", import.meta.url), "utf8")) as object;
    const validate = new Ajv2020({ strict: true }).compile(schema);
    const fetcher: typeof fetch = vi.fn(() => Promise.resolve(Response.json({
      assignee: "subject-1",
      createTime: "2026-07-26T16:00:00+08:00",
      id: "task-1",
      processDefinitionId: "syntheticHumanTaskV1:1:definition-1",
      processInstanceId: "instance-1",
      taskDefinitionKey: "syntheticReviewTask",
    })));
    const engine = createFlowableRestEngine({ baseUrl: "http://127.0.0.1:18082/flowable-rest/service/", fetch: fetcher, password: "synthetic-test-secret", timeoutMs: 1000, username: "synthetic-test-user" });
    const task = await engine.getTask("task-1");
    const data = { ...task, eventKey: "a".repeat(64), occurrence: "claimed", sourceRevision: 3 };
    expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
    expect(data).toMatchObject({ createdAt: "2026-07-26T08:00:00.000Z", sourceRevision: 3 });
  });

  it("validates adapter-normalized process lifecycle data against the published schema", async () => {
    const schema = JSON.parse(await readFile(new URL("../../../../contracts/events/workflow-process-lifecycle.v1.schema.json", import.meta.url), "utf8")) as object;
    const validate = new Ajv2020({ strict: true }).compile(schema);
    const definition = { deploymentId: "deployment-1", id: "syntheticHumanTaskV1:1:definition-1", key: "syntheticHumanTaskV1", resource: "synthetic.bpmn20.xml", version: 1 };
    const fetcher: typeof fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: "instance-1", processDefinitionId: definition.id, startTime: "2026-07-26T16:00:00+08:00" }))
      .mockResolvedValueOnce(Response.json(definition));
    const engine = createFlowableRestEngine({ baseUrl: "http://127.0.0.1:18082/flowable-rest/service/", fetch: fetcher, password: "synthetic-test-secret", timeoutMs: 1000, username: "synthetic-test-user" });
    const instance = await engine.getInstance("instance-1");
    const data = { ...instance, eventKey: "b".repeat(64), occurrence: "started" };
    expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
    expect(data).toMatchObject({ definitionKey: "syntheticHumanTaskV1", startedAt: "2026-07-26T08:00:00.000Z" });
  });
});
