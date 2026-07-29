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

test("contracts the reviewed Task projection policy while blocking release activation without trusted evidence", () => {
  assert.deepEqual(Object.keys(topology.operations).sort(), [
    "consumeTaskProjectionLifecycle",
    "publishTaskProjectionLifecycle",
    "publishTaskProjectionLifecycleRetry",
  ]);
  const policy = topology.operations.consumeTaskProjectionLifecycle["x-ai-crm-runtime-policy"];
  assert.deepEqual(policy, {
    id: "taskProjectionLifecyclePolicyV1",
    owner: "platform.task-center",
    handler: "task-center.postgres-projection-apply.v1",
    maxAttempts: 3,
    backoffSeconds: [30, 300],
    timeoutMs: 10000,
    prefetch: 2,
    concurrency: 1,
    retryableErrors: [
      { code: "TASK_STORAGE_UNAVAILABLE", retryableFlagRequired: true },
      { code: "eventing_storage_unavailable", retryableFlagRequired: true },
      { code: "eventing_conflict", retryableFlagRequired: true },
      { code: "eventing_handler_timeout", retryableFlagRequired: true },
    ],
    unknownErrorDisposition: "terminal",
    policyVersion: 1,
  });
  assert.deepEqual(
    topology.operations.consumeTaskProjectionLifecycle["x-ai-crm-activation"],
    {
      enabled: false,
      blockedBy: [
        "trusted-production-rabbitmq-tls-and-image-evidence",
        "least-privilege-vhost-secret-rotation-evidence",
        "inbox-retry-dlq-recovery-and-drain-evidence",
        "deployed-alert-owner-and-runbook-evidence",
      ],
    },
  );
  assert.deepEqual(
    topology.operations.publishTaskProjectionLifecycleRetry["x-ai-crm-routing-keys"],
    [
      "task-center.projection-lifecycle.v1.retry.30s",
      "task-center.projection-lifecycle.v1.retry.300s",
    ],
  );
  assert.equal(
    topology.channels.taskProjectionLifecycleRetryExchange.bindings.amqp.exchange.name,
    "ai-crm.platform.retry.v1",
  );
  assert.deepEqual(
    topology.operations.consumeTaskProjectionLifecycle["x-ai-crm-failure-handling"].retryRoute,
    {
      exchange: "ai-crm.platform.retry.v1",
      layers: [
        { attempt: 2, delaySeconds: 30, routingKey: "task-center.projection-lifecycle.v1.retry.30s" },
        { attempt: 3, delaySeconds: 300, routingKey: "task-center.projection-lifecycle.v1.retry.300s" },
      ],
    },
  );
  const delays = [
    topology.channels.taskProjectionLifecycleRetry30Queue,
    topology.channels.taskProjectionLifecycleRetry300Queue,
  ];
  assert.deepEqual(delays.map((channel) => channel["x-ai-crm-queue-arguments"]["x-message-ttl"]), [30000, 300000]);
  assert.equal(delays.every((channel) => channel["x-ai-crm-consumer-forbidden"] === true), true);
  assert.equal(delays.every((channel) => channel["x-ai-crm-queue-arguments"]["x-dead-letter-exchange"] === "ai-crm.platform.events.v1"), true);
  assert.equal(topology["x-ai-crm-topology-policy"].retryPolicy.delayMechanism, "fixed-queue-level-ttl-with-dlx");
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
