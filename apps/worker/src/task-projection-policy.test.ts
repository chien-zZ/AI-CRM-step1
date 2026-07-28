import { describe, expect, it } from "vitest";
import { EventingError } from "@ai-crm/platform-eventing-outbox";
import { TaskCenterError } from "@ai-crm/platform-task-center";
import {
  classifyTaskProjectionError,
  taskProjectionBindingId,
  taskProjectionConsumerId,
  taskProjectionRabbitTopology,
  taskProjectionRuntimePolicy,
} from "./task-projection-policy.js";

describe("Task projection runtime policy", () => {
  it("seals the ADR-0027 runtime values and fixed TTL topology", () => {
    expect(taskProjectionBindingId).toBe("platform.task-center.projection.v1");
    expect(taskProjectionConsumerId).toBe(taskProjectionBindingId);
    expect(taskProjectionRuntimePolicy).toEqual({
      backoffSeconds: [30, 300],
      concurrency: 1,
      handler: "task-center.postgres-projection-apply.v1",
      id: "taskProjectionLifecyclePolicyV1",
      maxAttempts: 3,
      owner: "platform.task-center",
      policyVersion: 1,
      prefetch: 2,
      timeoutMs: 10_000,
    });
    expect(taskProjectionRabbitTopology).toMatchObject({
      bindingId: taskProjectionBindingId,
      deadLetterExchange: "ai-crm.platform.dead-letter.v1",
      deadLetterQueue: "ai-crm.platform.task-center.projection.dead.v1",
      exchange: "ai-crm.platform.events.v1",
      queue: "ai-crm.platform.task-center.projection.v1",
      routingKey: "task-center.projection-lifecycle.v1",
    });
    expect(taskProjectionRabbitTopology.retryLayers).toEqual([
      {
        delaySeconds: 30,
        exchange: "ai-crm.platform.retry.v1",
        queue: "ai-crm.platform.task-center.projection.retry.30s.v1",
        routingKey: "task-center.projection-lifecycle.v1.retry.30s",
      },
      {
        delaySeconds: 300,
        exchange: "ai-crm.platform.retry.v1",
        queue: "ai-crm.platform.task-center.projection.retry.300s.v1",
        routingKey: "task-center.projection-lifecycle.v1.retry.300s",
      },
    ]);
    expect(Object.isFrozen(taskProjectionRuntimePolicy)).toBe(true);
    expect(Object.isFrozen(taskProjectionRuntimePolicy.backoffSeconds)).toBe(true);
    expect(Object.isFrozen(taskProjectionRabbitTopology)).toBe(true);
    expect(Object.isFrozen(taskProjectionRabbitTopology.retryLayers)).toBe(true);
  });

  it("retries only reviewed stable errors that explicitly remain retryable", () => {
    expect(classifyTaskProjectionError(new TaskCenterError("TASK_STORAGE_UNAVAILABLE", { retryable: true }))).toBe("retryable");
    expect(classifyTaskProjectionError(new TaskCenterError("TASK_STORAGE_UNAVAILABLE"))).toBe("terminal");
    expect(classifyTaskProjectionError(new TaskCenterError("TASK_INPUT_INVALID", { retryable: true }))).toBe("terminal");
    for (const code of ["eventing_storage_unavailable", "eventing_conflict", "eventing_handler_timeout"] as const) {
      expect(classifyTaskProjectionError(new EventingError(code, true))).toBe("retryable");
      expect(classifyTaskProjectionError(new EventingError(code))).toBe("terminal");
    }
    expect(classifyTaskProjectionError(new EventingError("eventing_invalid_input", true))).toBe("terminal");
    expect(classifyTaskProjectionError(new Error("TASK_STORAGE_UNAVAILABLE"))).toBe("terminal");
    expect(classifyTaskProjectionError({ code: "eventing_handler_timeout", retryable: true })).toBe("terminal");
  });
});
