import type { EventEnvelope, EventingCore, RabbitDelivery, ValidatedMessage } from "@ai-crm/platform-eventing-outbox";
import { EventingError } from "@ai-crm/platform-eventing-outbox";
import { TaskCenterError } from "@ai-crm/platform-task-center";
import { describe, expect, it, vi } from "vitest";
import type { RabbitConsumerAdapter } from "./handlers.js";
import {
  createTaskProjectionConsumerHandler,
  createTaskProjectionMessageHandler,
  type AbortableTaskProjectionApplyPort,
} from "./task-projection-composition.js";
import { taskProjectionBindingId, taskProjectionRuntimePolicy } from "./task-projection-policy.js";

const envelope = (dataOverride: Record<string, unknown> = {}): EventEnvelope => ({
  specversion: "1.0",
  id: "018f3f7a-9ec6-7c65-8e6e-6c9e43043111",
  source: "urn:ai-crm:platform.task-center",
  type: "task-center.projection-lifecycle.v1",
  time: "2026-07-28T00:00:00.000Z",
  datacontenttype: "application/json",
  dataschema: "urn:ai-crm:events:task-projection-lifecycle:v1",
  correlationid: "018f3f7a-9ec6-7c65-8e6e-6c9e43043112",
  data: {
    eventId: "018f3f7a-9ec6-7c65-8e6e-6c9e43043113",
    sourceType: "workflow",
    sourceTaskId: "task.synthetic",
    sourceVersion: 2,
    occurredAt: "2026-07-28T00:00:00.000Z",
    status: "open",
    deepLink: { appId: "workbench", routeId: "task-detail" },
    ...dataOverride,
  },
});

const message = (value: EventEnvelope = envelope()): ValidatedMessage => ({
  envelope: value,
  messageId: value.id,
  messageKind: "event",
  messageType: value.type,
  messageVersion: 1,
  producer: value.source,
  occurredAt: new Date(value.time),
  availableAt: new Date(value.time),
  correlationId: value.correlationid,
  serialized: JSON.stringify(value),
  payloadSha256: "0".repeat(64),
});

function adapterFor(delivery?: RabbitDelivery): RabbitConsumerAdapter {
  return {
    bindingIds: () => [taskProjectionBindingId],
    concurrency: taskProjectionRuntimePolicy.concurrency,
    prefetch: taskProjectionRuntimePolicy.prefetch,
    drain: () => Promise.resolve(),
    healthy: () => true,
    ready: () => undefined,
    run: delivery === undefined
      ? () => new Promise(() => undefined)
      : async (accept) => { await accept(taskProjectionBindingId, delivery); },
    stop: () => undefined,
  };
}

describe("Task projection consumer composition", () => {
  it("strictly converts the reviewed v1 event and passes the handler signal to the apply port", async () => {
    const signal = new AbortController().signal;
    const apply = vi.fn(() => Promise.resolve({ status: "applied" }));
    await createTaskProjectionMessageHandler({ apply }).handle(message(), signal);
    expect(apply).toHaveBeenCalledWith({
      eventId: "018f3f7a-9ec6-7c65-8e6e-6c9e43043113",
      sourceType: "workflow",
      sourceTaskId: "task.synthetic",
      sourceVersion: 2,
      occurredAt: "2026-07-28T00:00:00.000Z",
      status: "open",
      deepLink: { appId: "workbench", routeId: "task-detail" },
    }, signal);
  });

  it("rejects unreviewed schema or data fields before calling the apply port", async () => {
    const apply = vi.fn(() => Promise.resolve());
    const handler = createTaskProjectionMessageHandler({ apply });
    const wrongSchema = { ...envelope(), dataschema: "urn:ai-crm:events:other:v1" } as EventEnvelope;
    await expect(handler.handle(message(wrongSchema), new AbortController().signal)).rejects.toMatchObject({ code: "eventing_invalid_input" });
    await expect(handler.handle(message(envelope({ inventedField: "forbidden" })), new AbortController().signal)).rejects.toMatchObject({ code: "eventing_invalid_input" });
    expect(apply).not.toHaveBeenCalled();
  });

  it("does not replace cancellation with a Promise race and lets the apply port settle after observing abort", async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const port: AbortableTaskProjectionApplyPort = {
      apply: (_event, signal) => new Promise<void>((resolve) => {
        received = signal;
        signal.addEventListener("abort", () => { resolve(); }, { once: true });
      }),
    };
    const handling = createTaskProjectionMessageHandler(port).handle(message(), controller.signal);
    controller.abort();
    await expect(handling).resolves.toBeUndefined();
    expect(received).toBe(controller.signal);
    expect(received?.aborted).toBe(true);
  });

  it("uses the sealed classifier and retry delay before ACK", async () => {
    const order: string[] = [];
    const delivery: RabbitDelivery = {
      body: Buffer.from(JSON.stringify(envelope())),
      attempt: 1,
      ack: () => { order.push("ack"); },
      retry: (delaySeconds) => { order.push(`retry:${String(delaySeconds)}`); return Promise.resolve(); },
      deadLetter: () => { order.push("dead-letter"); },
    };
    const consume = vi.fn(() => Promise.reject(new TaskCenterError("TASK_STORAGE_UNAVAILABLE", { retryable: true })));
    const core = { consume } as unknown as EventingCore;
    const handler = createTaskProjectionConsumerHandler(core, adapterFor(delivery), { apply: vi.fn() });
    await handler.run(new AbortController().signal);
    expect(order).toEqual(["retry:30", "ack"]);
    expect(consume).toHaveBeenCalledWith(expect.objectContaining({
      attempt: 1,
      consumer: taskProjectionBindingId,
      timeoutMs: 10_000,
    }), expect.objectContaining({ messageType: "task-center.projection-lifecycle.v1", messageVersion: 1 }));
  });

  it("dead-letters unknown failures and rejects adapters that differ from the sealed runtime policy", async () => {
    const ack = vi.fn();
    const retry = vi.fn(() => Promise.resolve());
    const deadLetter = vi.fn();
    const delivery: RabbitDelivery = {
      body: Buffer.from(JSON.stringify(envelope())),
      attempt: 1,
      ack,
      retry,
      deadLetter,
    };
    const core = { consume: () => Promise.reject(new Error("unknown")) } as unknown as EventingCore;
    await createTaskProjectionConsumerHandler(core, adapterFor(delivery), { apply: vi.fn() }).run(new AbortController().signal);
    expect(deadLetter).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(() => createTaskProjectionConsumerHandler(core, { ...adapterFor(), prefetch: 1 }, { apply: vi.fn() }))
      .toThrow("worker_task_projection_runtime_policy_mismatch");
  });

  it("rejects an invalid apply port at composition time", () => {
    expect(() => createTaskProjectionMessageHandler({} as AbortableTaskProjectionApplyPort)).toThrow("worker_task_projection_port_invalid");
    expect(new EventingError("eventing_invalid_input").retryable).toBe(false);
  });
});
