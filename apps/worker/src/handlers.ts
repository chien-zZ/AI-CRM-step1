import {
  handleRabbitDelivery,
  type EventingCore,
  type MessageHandler,
  type OutboxPublisher,
  type RabbitDelivery,
} from "@ai-crm/platform-eventing-outbox";
import type {
  FileCenterService,
  FileCommandMetadata,
  ScanContentCommand,
} from "@ai-crm/platform-file-center";
import type { NotificationActor, NotificationCenter, NotificationIntent } from "@ai-crm/platform-notifications";
import type { TaskActor, TaskCenter, TaskProjectionKey } from "@ai-crm/platform-task-center";
import type { WorkerHandler } from "./index.js";

const STABLE_ID = /^[a-z][a-z0-9._-]{0,127}$/u;

function positiveInterval(value: number): number {
  if (!Number.isSafeInteger(value) || value < 10 || value > 300_000) throw new Error("worker_interval_invalid");
  return value;
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = (): void => { signal.removeEventListener("abort", aborted); resolve(); };
    const timer = setTimeout(finish, ms);
    const aborted = (): void => { clearTimeout(timer); finish(); };
    signal.addEventListener("abort", aborted, { once: true });
  });
}

async function yieldToEventLoop(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = (): void => { signal.removeEventListener("abort", aborted); resolve(); };
    const immediate = setImmediate(finish);
    const aborted = (): void => { clearImmediate(immediate); finish(); };
    signal.addEventListener("abort", aborted, { once: true });
  });
}

export function createOutboxPublisherLoopHandler(publisher: OutboxPublisher, intervalMs: number): WorkerHandler {
  const interval = positiveInterval(intervalMs);
  return Object.freeze({
    name: "eventing.outbox-publisher",
    ready: () => undefined,
    async run(signal: AbortSignal): Promise<void> {
      while (!signal.aborted) {
        await publisher.publishBatch();
        await delay(interval, signal);
      }
    },
  });
}

export interface RabbitConsumerAdapter {
  readonly bindingIds: () => readonly string[];
  readonly concurrency: number;
  readonly prefetch: number;
  readonly drain: () => Promise<void>;
  readonly healthy: () => boolean;
  readonly ready: (signal: AbortSignal) => void | Promise<void>;
  readonly run: (delivery: (bindingId: string, message: RabbitDelivery) => Promise<void>, signal: AbortSignal) => Promise<void>;
  readonly stop: () => void | Promise<void>;
}

export interface RabbitInboxBinding {
  readonly bindingId: string;
  readonly consumer: string;
  readonly handler: MessageHandler;
  readonly eventPolicy: { readonly maxAttempts: number; readonly backoffSeconds: readonly number[]; readonly timeoutMs: number };
  readonly classify: (error: unknown) => "retryable" | "terminal";
}

export function createRabbitInboxHandler(core: EventingCore, adapter: RabbitConsumerAdapter, bindings: readonly RabbitInboxBinding[]): WorkerHandler {
  if (!Number.isSafeInteger(adapter.prefetch) || adapter.prefetch < 1 || adapter.prefetch > 10_000 || !Number.isSafeInteger(adapter.concurrency) || adapter.concurrency < 1 || adapter.concurrency > adapter.prefetch) throw new Error("worker_rabbit_bindings_invalid");
  const byId = new Map<string, RabbitInboxBinding>();
  for (const binding of bindings) {
    if (!STABLE_ID.test(binding.bindingId) || !STABLE_ID.test(binding.consumer) || byId.has(binding.bindingId)) throw new Error("worker_rabbit_bindings_invalid");
    byId.set(binding.bindingId, binding);
  }
  const reportedBindingIds: unknown = adapter.bindingIds();
  if (!Array.isArray(reportedBindingIds) || !reportedBindingIds.every((id: unknown): id is string => typeof id === "string")) throw new Error("worker_rabbit_bindings_invalid");
  const actualBindingIds: readonly string[] = reportedBindingIds;
  if (actualBindingIds.length !== byId.size || new Set(actualBindingIds).size !== actualBindingIds.length || actualBindingIds.some((id) => !STABLE_ID.test(id) || !byId.has(id))) throw new Error("worker_rabbit_bindings_invalid");
  return Object.freeze({
    name: "eventing.rabbit-inbox",
    ready: async (signal: AbortSignal) => {
      if (bindings.length === 0 || !adapter.healthy()) throw new Error("worker_rabbit_not_ready");
      await adapter.ready(signal);
    },
    run: (signal: AbortSignal) => adapter.run(async (bindingId, delivery) => {
      const binding = byId.get(bindingId);
      if (!binding) throw new Error("worker_rabbit_binding_unregistered");
      await handleRabbitDelivery(
        delivery,
        (envelope, attempt, timeoutMs) => core.consume({ attempt, consumer: binding.consumer, envelope, timeoutMs }, binding.handler).then(() => undefined),
        { classify: binding.classify, eventPolicy: binding.eventPolicy },
      );
    }, signal),
    stop: async () => { await adapter.stop(); await adapter.drain(); },
  });
}

export interface FileMaintenanceSource {
  next(signal: AbortSignal): Promise<
    | { readonly kind: "cleanup"; readonly command: FileCommandMetadata & { readonly sessionId: string } }
    | { readonly kind: "reconcile"; readonly command: FileCommandMetadata & { readonly contentVersionId: string } }
    | { readonly kind: "scan"; readonly command: ScanContentCommand }
    | { readonly status: "closed" }
    | undefined
  >;
}

export function createFileMaintenanceHandler(service: FileCenterService, source: FileMaintenanceSource): WorkerHandler {
  return Object.freeze({
    name: "file.maintenance",
    ready: () => undefined,
    async run(signal: AbortSignal): Promise<void> {
      while (!signal.aborted) {
        const work = await source.next(signal);
        if (!work) { await delay(100, signal); continue; }
        if ("status" in work) return;
        if (work.kind === "scan") await service.scanContentVersion(work.command);
        else if (work.kind === "cleanup") await service.cleanupUploadSession(work.command);
        else await service.reconcileContentVersion(work.command);
        await yieldToEventLoop(signal);
      }
    },
  });
}

export interface TaskReconciliationSource {
  next(signal: AbortSignal): Promise<{ readonly actor: TaskActor; readonly key: TaskProjectionKey } | { readonly status: "closed" } | undefined>;
}

export function createTaskReconciliationHandler(service: TaskCenter, source: TaskReconciliationSource): WorkerHandler {
  return Object.freeze({
    name: "task.reconciliation",
    ready: () => undefined,
    async run(signal: AbortSignal): Promise<void> {
      while (!signal.aborted) {
        const work = await source.next(signal);
        if (!work) { await delay(100, signal); continue; }
        if ("status" in work) return;
        await service.reconcile(work.actor, work.key);
        await yieldToEventLoop(signal);
      }
    },
  });
}

export interface NotificationIntentSource {
  next(signal: AbortSignal): Promise<{ readonly actor: NotificationActor; readonly intent: NotificationIntent } | { readonly status: "closed" } | undefined>;
}

export function createNotificationIntentHandler(service: NotificationCenter, source: NotificationIntentSource): WorkerHandler {
  return Object.freeze({
    name: "notification.intent",
    ready: () => undefined,
    async run(signal: AbortSignal): Promise<void> {
      while (!signal.aborted) {
        const work = await source.next(signal);
        if (!work) { await delay(100, signal); continue; }
        if ("status" in work) return;
        await service.submitIntent(work.actor, work.intent);
        await yieldToEventLoop(signal);
      }
    },
  });
}
