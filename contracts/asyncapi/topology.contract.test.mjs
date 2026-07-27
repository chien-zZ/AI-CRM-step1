import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Parser } from "@asyncapi/parser";
import Ajv2020 from "ajv/dist/2020.js";
import YAML from "yaml";

const directory = dirname(fileURLToPath(import.meta.url));
const topologyPath = resolve(directory, "topology.asyncapi.yaml");
const source = await readFile(topologyPath, "utf8");
const topology = YAML.parse(source);

test("resolves document-relative Event and Job schemas from the AsyncAPI source path", async () => {
  const parsed = await new Parser().parse(source, { source: topologyPath });
  assert.equal(
    parsed.diagnostics.some((item) => item.severity === 0),
    false,
    JSON.stringify(parsed.diagnostics),
  );
  const references = [...source.matchAll(/\$ref: (\.\.\/(?:events|jobs)\/[^\s]+)/g)].map((match) => match[1]);
  assert.equal(references.length, 9);
  assert.equal(references.every((reference) => !reference.startsWith("contracts/")), true);
});

test("blocks unsafe retry activation and defines normative delivery attempts", () => {
  assert.deepEqual(Object.keys(topology.operations).sort(), [
    "consumeTaskProjectionLifecycle",
    "publishTaskProjectionLifecycle",
  ]);
  assert.equal(topology.channels.taskProjectionLifecycleRetryExchange, undefined);
  assert.equal(topology.channels.taskProjectionLifecycleRetryQueue, undefined);
  assert.deepEqual(
    topology.operations.consumeTaskProjectionLifecycle["x-ai-crm-activation"],
    {
      enabled: false,
      blockedBy: [
        "reviewed-event-runtime-policy-values",
        "reviewed-rabbitmq-delay-mechanism",
      ],
    },
  );
  assert.equal(
    topology.operations.consumeTaskProjectionLifecycle["x-ai-crm-failure-handling"].retryRoute,
    "unresolved",
  );
  assert.deepEqual(topology["x-ai-crm-topology-policy"].deliveryAttempt, {
    header: "x-ai-crm-delivery-attempt",
    initialPublicationValue: 1,
    consumedDeliveryHeaderRequired: true,
    retryAllowedWhen: "N < maxAttempts",
    retryPublicationValue: "N + 1",
    retryDelaySeconds: "backoffSeconds[N - 1]",
    retryPublicationConfirmRequiredBeforeAck: true,
    deadLetterExchangePreservesValue: true,
    outboxPublishAttemptIsIndependent: true,
  });
  assert.equal(
    topology.components.schemas.rabbitMessageHeadersV1.required.includes("x-ai-crm-delivery-attempt"),
    true,
  );
});

test("uses environment-isolated VHost configuration and routes only the owned consumer", () => {
  assert.deepEqual(topology["x-ai-crm-topology-policy"].vhost, {
    valueSource: "application-runtime-config",
    environmentIsolated: true,
    emptyOrImplicitDefaultForbidden: true,
  });
  const serializedBindings = JSON.stringify(
    Object.values(topology.channels).map((channel) => channel.bindings?.amqp),
  );
  assert.equal(serializedBindings.includes("vhost"), false);
  assert.equal(
    topology.channels.taskProjectionLifecycleExchange.bindings.amqp.exchange.name,
    "ai-crm.platform.events.v1",
  );
  assert.equal(
    topology.channels.taskProjectionLifecycleQueue.bindings.amqp.queue.name,
    "ai-crm.platform.task-center.projection.v1",
  );
  assert.equal(
    topology.channels.taskProjectionLifecycleDeadLetterQueue["x-ai-crm-replay"].enabled,
    false,
  );
  const routed = JSON.stringify(topology.channels);
  assert.equal(routed.includes("organizationChangeV1"), false);
  assert.equal(routed.includes("workflowProcessLifecycleV1"), false);
  assert.equal(routed.includes("workflowTaskLifecycleV1"), false);
  assert.equal(routed.includes("privateWorkerJobV1"), false);
});

test("composes the Task projection envelope and data schemas", async () => {
  const envelope = JSON.parse(await readFile(resolve(directory, "../events/event-envelope.v1.schema.json"), "utf8"));
  const data = JSON.parse(await readFile(resolve(directory, "../events/task-projection-lifecycle.v1.schema.json"), "utf8"));
  const ajv = new Ajv2020({ strict: true });
  ajv.addSchema(envelope);
  ajv.addSchema(data);
  const validate = ajv.compile({
    allOf: [
      { $ref: envelope.$id },
      {
        type: "object",
        required: ["type", "dataschema", "data"],
        properties: {
          type: { const: "task-center.projection-lifecycle.v1" },
          dataschema: { const: "urn:ai-crm:events:task-projection-lifecycle:v1" },
          data: { $ref: data.$id },
        },
      },
    ],
  });
  const message = {
    specversion: "1.0",
    id: "43000000-0000-4000-8000-000000000001",
    source: "urn:ai-crm:synthetic-source",
    type: "task-center.projection-lifecycle.v1",
    time: "2026-07-27T00:00:00.000Z",
    datacontenttype: "application/json",
    dataschema: "urn:ai-crm:events:task-projection-lifecycle:v1",
    correlationid: "43000000-0000-4000-8000-000000000002",
    data: {
      eventId: "43000000-0000-4000-8000-000000000003",
      sourceType: "synthetic",
      sourceTaskId: "task.1",
      sourceVersion: 1,
      occurredAt: "2026-07-27T00:00:00.000Z",
      status: "open",
      deepLink: { appId: "workbench", routeId: "task-detail" },
    },
  };
  assert.equal(validate(message), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...message, type: "workflow.task-lifecycle.v1" }), false);
  assert.equal(
    validate({
      ...message,
      data: {
        ...message.data,
        deepLink: { appId: "https://outside.invalid", routeId: "task-detail" },
      },
    }),
    false,
  );
});
