import { EventEmitter } from "node:events";
import type { Channel, ChannelModel, ConfirmChannel, ConsumeMessage, Message, Options, Replies } from "amqplib";
import { describe, expect, it, vi } from "vitest";
import type { RabbitConnectionConfiguration } from "./rabbit-config.js";
import { createAmqplibConsumerAdapter, createAmqplibPublisherAdapter, createAmqplibResourceRuntime, type RabbitConsumerTopology } from "./rabbit-adapter.js";

const configuration: RabbitConnectionConfiguration = {
  ca: Buffer.from("unused-by-fake"), heartbeatSeconds: 30, hostname: "rabbit.internal", password: "secret",
  port: 5671, servername: "rabbit.internal", tls: true, username: "synthetic", vhost: "ai-crm-test",
};

class FakeChannel extends EventEmitter {
  public acknowledgements: string[] = [];
  public cancelled: string[] = [];
  public confirms: Array<(error?: unknown) => void> = [];
  public closeFailure = false;
  public closePending = false;
  public closeCalls = 0;
  public consumeCallback: ((message: ConsumeMessage | null) => void) | undefined;
  public consumedQueue: string | undefined;
  public publishWritable = true;
  public published: Array<{ readonly options: Options.Publish; readonly routingKey: string }> = [];
  public assertExchange(): Promise<Replies.AssertExchange> { return Promise.resolve({ exchange: "synthetic" }); }
  public assertQueue(queue: string): Promise<Replies.AssertQueue> { return Promise.resolve({ consumerCount: 0, messageCount: 0, queue }); }
  public bindQueue(): Promise<Replies.Empty> { return Promise.resolve({}); }
  public prefetch(): Promise<Replies.Empty> { return Promise.resolve({}); }
  public consume(queue: string, callback: (message: ConsumeMessage | null) => void): Promise<Replies.Consume> { this.consumedQueue = queue; this.consumeCallback = callback; return Promise.resolve({ consumerTag: "synthetic-tag" }); }
  public cancel(tag: string): Promise<Replies.Empty> { this.cancelled.push(tag); return Promise.resolve({}); }
  public ack(): void { this.acknowledgements.push("ack"); }
  public nack(): void { this.acknowledgements.push("nack"); }
  public publish(_exchange: string, routingKey: string, _content: Buffer, options: Options.Publish = {}, callback?: (error: unknown, ok: Replies.Empty) => void): boolean { this.published.push({ options, routingKey }); this.confirms.push((error?: unknown) => { callback?.(error, {}); }); return this.publishWritable; }
  public waitForConfirms(): Promise<void> { return Promise.resolve(); }
  public close(): Promise<void> { this.closeCalls += 1; if (this.closeFailure) return Promise.reject(new Error("synthetic-close-failure")); if (this.closePending) return new Promise(() => undefined); this.emit("close"); return Promise.resolve(); }
}

class FakeModel extends EventEmitter {
  public channelPending = false;
  public closeCalls = 0;
  public closeFailure = false;
  public closePending = false;
  public confirmPending = false;
  public constructor(public readonly normal: FakeChannel, public readonly confirm: FakeChannel) { super(); }
  public createChannel(): Promise<Channel> { return this.channelPending ? new Promise(() => undefined) : Promise.resolve(this.normal as unknown as Channel); }
  public createConfirmChannel(): Promise<ConfirmChannel> { return this.confirmPending ? new Promise(() => undefined) : Promise.resolve(this.confirm as unknown as ConfirmChannel); }
  public close(): Promise<void> { this.closeCalls += 1; if (this.closeFailure) return Promise.reject(new Error("synthetic-model-close-failure")); if (this.closePending) return new Promise(() => undefined); this.emit("close"); return Promise.resolve(); }
}

const topology: RabbitConsumerTopology = {
  bindingId: "synthetic.binding",
  deadLetterExchange: "synthetic.dlx",
  deadLetterQueue: "synthetic.dlq",
  deadLetterRoutingKey: "synthetic.dead",
  exchange: "synthetic.events",
  exchangeType: "topic",
  queue: "synthetic.queue",
  retryLayers: [{ delaySeconds: 5, exchange: "synthetic.retry", queue: "synthetic.retry.5", routingKey: "synthetic.retry.5" }],
  routingKey: "synthetic.changed.v1",
};

function message(attempt = 1): ConsumeMessage {
  return {
    content: Buffer.from("{}"),
    fields: { consumerTag: "synthetic-tag", deliveryTag: 1, exchange: topology.exchange, redelivered: false, routingKey: topology.routingKey },
    properties: { appId: "urn:ai-crm:synthetic", clusterId: undefined, contentEncoding: undefined, contentType: "application/json", correlationId: "00000000-0000-4000-8000-000000000002", deliveryMode: 2, expiration: undefined, headers: { "x-ai-crm-delivery-attempt": attempt, "x-ai-crm-kind": "event", "x-ai-crm-version": 1 }, messageId: "00000000-0000-4000-8000-000000000001", priority: undefined, replyTo: undefined, timestamp: undefined, type: "synthetic.changed.v1", userId: undefined },
  };
}

describe("amqplib topology-free resource runtime", () => {
  it("force-closes an acquired model when channel creation never settles", async () => {
    const model = new FakeModel(new FakeChannel(), new FakeChannel());
    model.channelPending = true;
    const controller = new AbortController();
    const acquisition = createAmqplibResourceRuntime(configuration, () => Promise.resolve(model as unknown as ChannelModel), controller.signal);
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    controller.abort();
    await expect(acquisition).rejects.toThrow("worker_rabbit_acquisition_aborted");
    expect(model.closeCalls).toBe(1);
  });

  it("never declares or consumes topology and maps Blocked/channel-close to health", async () => {
    const normal = new FakeChannel();
    const model = new FakeModel(normal, new FakeChannel());
    const consume = vi.spyOn(normal, "consume");
    const assertQueue = vi.spyOn(normal, "assertQueue");
    const runtime = await createAmqplibResourceRuntime(configuration, () => Promise.resolve(model as unknown as ChannelModel));
    expect(runtime.healthy()).toBe(true);
    expect(consume).not.toHaveBeenCalled();
    expect(assertQueue).not.toHaveBeenCalled();
    model.emit("blocked", "synthetic");
    expect(runtime.healthy()).toBe(false);
    model.emit("unblocked");
    expect(runtime.healthy()).toBe(true);
    normal.emit("close");
    expect(runtime.healthy()).toBe(false);
    await runtime.close();
  });

  it("propagates close failure and supports aborting a stuck close", async () => {
    const failedModel = new FakeModel(new FakeChannel(), new FakeChannel());
    failedModel.normal.closeFailure = true;
    const failed = await createAmqplibResourceRuntime(configuration, () => Promise.resolve(failedModel as unknown as ChannelModel));
    await expect(failed.close()).rejects.toThrow("worker_rabbit_close_failed");

    const stuckModel = new FakeModel(new FakeChannel(), new FakeChannel());
    stuckModel.normal.closePending = true;
    const stuck = await createAmqplibResourceRuntime(configuration, () => Promise.resolve(stuckModel as unknown as ChannelModel));
    const controller = new AbortController();
    const closing = stuck.close(controller.signal);
    controller.abort();
    await expect(closing).rejects.toThrow("worker_rabbit_close_aborted");
  });
});

describe("amqplib publisher adapter", () => {
  it("force-closes an acquired model when confirm-channel creation never settles", async () => {
    const model = new FakeModel(new FakeChannel(), new FakeChannel());
    model.confirmPending = true;
    const controller = new AbortController();
    const acquisition = createAmqplibPublisherAdapter(configuration, () => Promise.resolve(model as unknown as ChannelModel), controller.signal);
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    controller.abort();
    await expect(acquisition).rejects.toThrow("worker_rabbit_acquisition_aborted");
    expect(model.closeCalls).toBe(1);
  });

  it("waits for write-buffer drain and rejects publication while backpressured", async () => {
    const normal = new FakeChannel(); const confirm = new FakeChannel(); const model = new FakeModel(normal, confirm);
    const adapter = await createAmqplibPublisherAdapter(configuration, () => Promise.resolve(model as unknown as ChannelModel));
    confirm.publishWritable = false;
    const id = "00000000-0000-4000-8000-000000000010";
    expect(adapter.channel.publishMandatory("synthetic.events", "synthetic.route", Buffer.from("{}"), { messageId: id })).toBe(false);
    expect(() => adapter.channel.publishMandatory("synthetic.events", "synthetic.route", Buffer.from("{}"), { messageId: "00000000-0000-4000-8000-000000000011" })).toThrow("worker_rabbit_publish_unavailable");
    const draining = adapter.channel.waitForDrain(); confirm.emit("drain"); await draining;
    const confirmation = adapter.channel.waitForConfirms(); confirm.confirms.shift()?.(); await confirmation;
    expect(adapter.channel.takeReturned(id)).toBe(false);
    expect(confirm.published[0]?.options).toMatchObject({ mandatory: true, persistent: true });
  });

  it("correlates mixed routed/returned concurrent publications with the same message ID", async () => {
    const confirm = new FakeChannel(); const model = new FakeModel(new FakeChannel(), confirm);
    const adapter = await createAmqplibPublisherAdapter(configuration, () => Promise.resolve(model as unknown as ChannelModel));
    const id = "00000000-0000-4000-8000-000000000012";
    adapter.channel.publishMandatory("synthetic.events", "synthetic.route", Buffer.from("{}"), { messageId: id });
    const first = adapter.channel.waitForConfirms();
    adapter.channel.publishMandatory("synthetic.events", "synthetic.missing", Buffer.from("{}"), { messageId: id });
    const second = adapter.channel.waitForConfirms();
    const returned: Message = message();
    returned.properties.messageId = id;
    const secondOptions = confirm.published[1]?.options as unknown as Readonly<Record<string, unknown>> | undefined;
    (returned.properties as unknown as Record<string, unknown>)["headers"] = secondOptions?.["headers"];
    // Rabbit may Return the second unroutable publication before either
    // per-message confirm callback is dispatched (for example before a batch ACK).
    confirm.emit("return", returned);
    confirm.confirms.shift()?.(); confirm.confirms.shift()?.();
    await Promise.all([first, second]);
    expect(adapter.channel.takeReturned(id)).toBe(false);
    expect(adapter.channel.takeReturned(id)).toBe(true);
  });

  it("does not let a nacked publication consume the return for a same-ID retry", async () => {
    const confirm = new FakeChannel(); const model = new FakeModel(new FakeChannel(), confirm);
    const adapter = await createAmqplibPublisherAdapter(configuration, () => Promise.resolve(model as unknown as ChannelModel));
    const id = "00000000-0000-4000-8000-000000000014";
    adapter.channel.publishMandatory("synthetic.events", "synthetic.route", Buffer.from("{}"), { messageId: id });
    const failed = adapter.channel.waitForConfirms();
    confirm.confirms.shift()?.(new Error("synthetic-nack"));
    await expect(failed).rejects.toThrow("worker_rabbit_publish_uncertain");

    adapter.channel.publishMandatory("synthetic.events", "synthetic.missing", Buffer.from("{}"), { messageId: id });
    const retried = adapter.channel.waitForConfirms();
    const returned = message();
    const retryOptions = confirm.published[1]?.options as unknown as Readonly<Record<string, unknown>> | undefined;
    (returned.properties as unknown as Record<string, unknown>)["headers"] = retryOptions?.["headers"];
    confirm.emit("return", returned);
    confirm.confirms.shift()?.();
    await retried;
    expect(adapter.channel.takeReturned(id)).toBe(true);
  });

  it("rejects uncertain confirms after connection error", async () => {
    const model = new FakeModel(new FakeChannel(), new FakeChannel());
    const adapter = await createAmqplibPublisherAdapter(configuration, () => Promise.resolve(model as unknown as ChannelModel));
    adapter.channel.publishMandatory("synthetic.events", "synthetic.route", Buffer.from("{}"), { messageId: "00000000-0000-4000-8000-000000000013" });
    const confirmation = adapter.channel.waitForConfirms();
    model.emit("error", new Error("synthetic-connection-error"));
    await expect(confirmation).rejects.toThrow("worker_rabbit_publish_uncertain");
    expect(adapter.healthy()).toBe(false);
  });
});

describe("amqplib consumer adapter", () => {
  it("cancels a consumer tag that is returned after run is aborted", async () => {
    const normal = new FakeChannel(); const model = new FakeModel(normal, new FakeChannel());
    let resolveConsume!: (reply: Replies.Consume) => void;
    vi.spyOn(normal, "consume").mockImplementation((queue, callback) => {
      normal.consumedQueue = queue; normal.consumeCallback = callback;
      return new Promise((resolve) => { resolveConsume = resolve; });
    });
    const adapter = await createAmqplibConsumerAdapter(configuration, [topology], { concurrency: 1, prefetch: 1 }, () => Promise.resolve(model as unknown as ChannelModel));
    const controller = new AbortController(); const run = adapter.run(() => Promise.resolve(), controller.signal);
    await vi.waitFor(() => { expect(resolveConsume).toBeTypeOf("function"); });
    controller.abort(); resolveConsume({ consumerTag: "late-tag" });
    await run; expect(normal.cancelled).toEqual(["late-tag"]); await adapter.drain();
  });

  it("confirms a reviewed retry before the handler can ACK the original delivery", async () => {
    const model = new FakeModel(new FakeChannel(), new FakeChannel());
    const adapter = await createAmqplibConsumerAdapter(configuration, [topology], { concurrency: 1, prefetch: 1 }, () => Promise.resolve(model as unknown as ChannelModel));
    const controller = new AbortController();
    const run = adapter.run(async (_binding, delivery) => { await delivery.retry(5); delivery.ack(); }, controller.signal);
    await vi.waitFor(() => { expect(model.normal.consumeCallback).toBeTypeOf("function"); });
    model.normal.consumeCallback?.(message());
    await vi.waitFor(() => { expect(model.confirm.published).toHaveLength(1); });
    expect(model.normal.acknowledgements).toEqual([]);
    model.confirm.confirms.shift()?.();
    await vi.waitFor(() => { expect(model.normal.acknowledgements).toEqual(["ack"]); });
    expect(model.confirm.published[0]).toMatchObject({ options: { headers: { "x-ai-crm-delivery-attempt": 2 }, mandatory: true, persistent: true } });
    controller.abort(); await run; await adapter.drain();
  });

  it("leaves the original unacknowledged and becomes unavailable when retry confirmation fails", async () => {
    const model = new FakeModel(new FakeChannel(), new FakeChannel());
    const adapter = await createAmqplibConsumerAdapter(configuration, [topology], { concurrency: 1, prefetch: 1 }, () => Promise.resolve(model as unknown as ChannelModel));
    const run = adapter.run(async (_binding, delivery) => { await delivery.retry(5); delivery.ack(); }, new AbortController().signal);
    await vi.waitFor(() => { expect(model.normal.consumeCallback).toBeTypeOf("function"); });
    model.normal.consumeCallback?.(message());
    await vi.waitFor(() => { expect(model.confirm.confirms).toHaveLength(1); });
    model.confirm.emit("close"); model.confirm.confirms.shift()?.();
    await expect(run).rejects.toThrow("worker_rabbit_consumer_unavailable");
    expect(model.normal.acknowledgements).toEqual([]);
    expect(adapter.healthy()).toBe(false);
    await adapter.drain();
  });

  it("cancels acquisition and rejects run when the retry confirm channel closes while idle", async () => {
    const model = new FakeModel(new FakeChannel(), new FakeChannel());
    const adapter = await createAmqplibConsumerAdapter(configuration, [topology], { concurrency: 1, prefetch: 1 }, () => Promise.resolve(model as unknown as ChannelModel));
    const run = adapter.run(() => Promise.resolve(), new AbortController().signal);
    await vi.waitFor(() => { expect(model.normal.consumeCallback).toBeTypeOf("function"); });
    model.confirm.emit("close");
    await expect(run).rejects.toThrow("worker_rabbit_consumer_unavailable");
    await vi.waitFor(() => { expect(model.normal.cancelled).toEqual(["synthetic-tag"]); });
    expect(adapter.healthy()).toBe(false);
    await adapter.drain();
  });

  it("rejects malformed or unbounded technical retry headers without publishing", async () => {
    const model = new FakeModel(new FakeChannel(), new FakeChannel());
    const adapter = await createAmqplibConsumerAdapter(configuration, [topology], { concurrency: 1, prefetch: 1 }, () => Promise.resolve(model as unknown as ChannelModel));
    const run = adapter.run(async (_binding, delivery) => { await delivery.retry(5); }, new AbortController().signal);
    await vi.waitFor(() => { expect(model.normal.consumeCallback).toBeTypeOf("function"); });
    const malformed = message(); malformed.properties.headers = { ...malformed.properties.headers, tracestate: `safe=${"x".repeat(600)}` };
    model.normal.consumeCallback?.(malformed);
    await expect(run).rejects.toThrow("worker_rabbit_delivery_failed");
    expect(model.confirm.published).toEqual([]);
    expect(model.normal.acknowledgements).toEqual([]);
    await adapter.drain();
  });

  it("rejects an overlong message type before retry publication", async () => {
    const model = new FakeModel(new FakeChannel(), new FakeChannel());
    const adapter = await createAmqplibConsumerAdapter(configuration, [topology], { concurrency: 1, prefetch: 1 }, () => Promise.resolve(model as unknown as ChannelModel));
    const run = adapter.run(async (_binding, delivery) => { await delivery.retry(5); }, new AbortController().signal);
    await vi.waitFor(() => { expect(model.normal.consumeCallback).toBeTypeOf("function"); });
    const malformed = message(); malformed.properties.type = `synthetic.${"a".repeat(130)}`;
    model.normal.consumeCallback?.(malformed);
    await expect(run).rejects.toThrow("worker_rabbit_delivery_failed");
    expect(model.confirm.published).toEqual([]);
    await adapter.drain();
  });

  it("rebuilds the private Return-correlation header for every retry", async () => {
    const model = new FakeModel(new FakeChannel(), new FakeChannel());
    const adapter = await createAmqplibConsumerAdapter(configuration, [topology], { concurrency: 1, prefetch: 1 }, () => Promise.resolve(model as unknown as ChannelModel));
    const controller = new AbortController();
    const run = adapter.run(async (_binding, delivery) => { await delivery.retry(5); }, controller.signal);
    await vi.waitFor(() => { expect(model.normal.consumeCallback).toBeTypeOf("function"); });
    const input = message(); input.properties.headers = { ...input.properties.headers, "x-ai-crm-private-publication-id": "00000000-0000-4000-8000-000000000099" };
    model.normal.consumeCallback?.(input);
    await vi.waitFor(() => { expect(model.confirm.published).toHaveLength(1); });
    const privateId = (model.confirm.published[0]?.options.headers as Readonly<Record<string, unknown>> | undefined)?.["x-ai-crm-private-publication-id"];
    expect(privateId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(privateId).not.toBe("00000000-0000-4000-8000-000000000099");
    model.confirm.confirms.shift()?.();
    await vi.waitFor(() => { expect(model.normal.acknowledgements).toEqual([]); });
    controller.abort(); await run; await adapter.drain();
  });

  it("uses manual non-requeue NACK for terminal isolation", async () => {
    const model = new FakeModel(new FakeChannel(), new FakeChannel());
    const adapter = await createAmqplibConsumerAdapter(configuration, [topology], { concurrency: 1, prefetch: 1 }, () => Promise.resolve(model as unknown as ChannelModel));
    const controller = new AbortController();
    const run = adapter.run((_binding, delivery) => { delivery.deadLetter(); return Promise.resolve(); }, controller.signal);
    await vi.waitFor(() => { expect(model.normal.consumeCallback).toBeTypeOf("function"); });
    model.normal.consumeCallback?.(message());
    await vi.waitFor(() => { expect(model.normal.acknowledgements).toEqual(["nack"]); });
    controller.abort(); await run; await adapter.drain();
  });

  it("fails readiness and stops acquisition when the broker blocks the connection", async () => {
    const model = new FakeModel(new FakeChannel(), new FakeChannel());
    const adapter = await createAmqplibConsumerAdapter(configuration, [topology], { concurrency: 1, prefetch: 1 }, () => Promise.resolve(model as unknown as ChannelModel));
    expect(adapter.healthy()).toBe(true);
    model.emit("blocked", "synthetic-resource-alarm");
    await vi.waitFor(() => { expect(adapter.healthy()).toBe(false); });
    expect(() => { void adapter.ready(new AbortController().signal); }).toThrow("worker_rabbit_not_ready");
    await adapter.drain();
  });

  it("treats an unsolicited broker consumer cancellation as fatal", async () => {
    const model = new FakeModel(new FakeChannel(), new FakeChannel());
    const adapter = await createAmqplibConsumerAdapter(configuration, [topology], { concurrency: 1, prefetch: 1 }, () => Promise.resolve(model as unknown as ChannelModel));
    const run = adapter.run(() => Promise.resolve(), new AbortController().signal);
    await vi.waitFor(() => { expect(model.normal.consumeCallback).toBeTypeOf("function"); });
    model.normal.consumeCallback?.(null);
    await expect(run).rejects.toThrow("worker_rabbit_consumer_cancelled");
    expect(adapter.healthy()).toBe(false);
    await adapter.drain();
  });

  it("cancels acquisition, bounds handler concurrency, drains active work, and closes", async () => {
    const model = new FakeModel(new FakeChannel(), new FakeChannel());
    const adapter = await createAmqplibConsumerAdapter(configuration, [topology], { concurrency: 1, prefetch: 2 }, () => Promise.resolve(model as unknown as ChannelModel));
    const controller = new AbortController(); let active = 0; let maximum = 0; let release: (() => void) | undefined;
    const run = adapter.run(async (_binding, delivery) => { active += 1; maximum = Math.max(maximum, active); await new Promise<void>((resolve) => { release = resolve; }); active -= 1; delivery.ack(); }, controller.signal);
    await vi.waitFor(() => { expect(model.normal.consumeCallback).toBeTypeOf("function"); });
    model.normal.consumeCallback?.(message()); model.normal.consumeCallback?.(message());
    await vi.waitFor(() => { expect(active).toBe(1); });
    controller.abort(); await run;
    expect(model.normal.cancelled).toEqual(["synthetic-tag"]);
    const draining = adapter.drain(); release?.(); await draining;
    expect(maximum).toBe(1);
  });

  it("supports deadline abort with forced close and does not swallow ordinary close failure", async () => {
    const firstModel = new FakeModel(new FakeChannel(), new FakeChannel());
    const first = await createAmqplibConsumerAdapter(configuration, [topology], { concurrency: 1, prefetch: 1 }, () => Promise.resolve(firstModel as unknown as ChannelModel));
    const runController = new AbortController(); let release: (() => void) | undefined;
    const run = first.run(async () => { await new Promise<void>((resolve) => { release = resolve; }); }, runController.signal);
    await vi.waitFor(() => { expect(firstModel.normal.consumeCallback).toBeTypeOf("function"); });
    firstModel.normal.consumeCallback?.(message()); await vi.waitFor(() => { expect(release).toBeTypeOf("function"); });
    runController.abort(); await run;
    const deadline = new AbortController(); const draining = first.drain(deadline.signal); deadline.abort();
    await expect(draining).rejects.toThrow("worker_rabbit_drain_aborted");
    release?.();

    const secondModel = new FakeModel(new FakeChannel(), new FakeChannel()); secondModel.normal.closeFailure = true;
    const second = await createAmqplibConsumerAdapter(configuration, [topology], { concurrency: 1, prefetch: 1 }, () => Promise.resolve(secondModel as unknown as ChannelModel));
    await expect(second.drain()).rejects.toThrow("worker_rabbit_close_failed");
  });

  it("owns an immutable deep copy of caller topology", async () => {
    const mutable = structuredClone(topology);
    const model = new FakeModel(new FakeChannel(), new FakeChannel());
    const adapter = await createAmqplibConsumerAdapter(configuration, [mutable], { concurrency: 1, prefetch: 1 }, () => Promise.resolve(model as unknown as ChannelModel));
    (mutable as { bindingId: string; queue: string }).bindingId = "mutated.binding";
    (mutable as { bindingId: string; queue: string }).queue = "mutated.queue";
    (mutable.retryLayers[0] as { delaySeconds: number }).delaySeconds = 99;
    expect(adapter.bindingIds()).toEqual(["synthetic.binding"]);
    const controller = new AbortController(); const run = adapter.run(() => Promise.resolve(), controller.signal);
    await vi.waitFor(() => { expect(model.normal.consumedQueue).toBe("synthetic.queue"); });
    controller.abort(); await run; await adapter.drain();
  });
});
