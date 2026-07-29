import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  connect as amqpConnect,
  type Channel,
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
  type Message,
  type Options,
} from "amqplib";
import type { RabbitConfirmChannel, RabbitDelivery } from "@ai-crm/platform-eventing-outbox";
import type { RabbitConsumerAdapter } from "./handlers.js";
import type { RabbitConnectionConfiguration } from "./rabbit-config.js";

const ENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u;
const BINDING = /^[a-z][a-z0-9._-]{0,127}$/u;
const ROUTING = /^[A-Za-z0-9*#][A-Za-z0-9._*#:-]{0,254}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/u;
const TRACESTATE = /^[\x20-\x7e]{1,512}$/u;
const MESSAGE_TYPE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;
const SOURCE = /^urn:ai-crm:[a-z][a-z0-9.-]*$/u;
const TRANSPORT_PUBLICATION_HEADER = "x-ai-crm-private-publication-id";

export interface RabbitRetryLayer {
  readonly delaySeconds: number;
  readonly exchange: string;
  readonly queue: string;
  readonly routingKey: string;
}

export interface RabbitConsumerTopology {
  readonly bindingId: string;
  readonly deadLetterExchange: string;
  readonly deadLetterQueue: string;
  readonly deadLetterRoutingKey: string;
  readonly exchange: string;
  readonly exchangeType: "direct" | "topic";
  readonly queue: string;
  readonly retryLayers: readonly RabbitRetryLayer[];
  readonly routingKey: string;
}

export interface RabbitPublisherAdapter {
  readonly channel: RabbitConfirmChannel;
  readonly close: (signal?: AbortSignal) => Promise<void>;
  readonly healthy: () => boolean;
}

/**
 * A connection/channel lifecycle probe. It deliberately owns no topology and
 * never calls consume; production composition can therefore validate the
 * consumer account and broker lifecycle without activating a binding.
 */
export interface RabbitResourceRuntime {
  readonly close: (signal?: AbortSignal) => Promise<void>;
  readonly healthy: () => boolean;
}

export interface AmqplibConnector {
  (configuration: RabbitConnectionConfiguration): Promise<ChannelModel>;
}

function stable(value: string, pattern = ENTITY): void {
  if (!pattern.test(value)) throw new Error("worker_rabbit_topology_invalid");
}

function copyTopologies(topologies: readonly RabbitConsumerTopology[]): readonly RabbitConsumerTopology[] {
  return Object.freeze(topologies.map((item) => Object.freeze({
    ...item,
    retryLayers: Object.freeze(item.retryLayers.map((layer) => Object.freeze({ ...layer }))),
  })));
}

function validateTopologies(topologies: readonly RabbitConsumerTopology[]): void {
  if (topologies.length < 1 || topologies.length > 1000) throw new Error("worker_rabbit_topology_invalid");
  const ids = new Set<string>();
  for (const item of topologies) {
    stable(item.bindingId, BINDING);
    stable(item.exchange);
    stable(item.queue);
    stable(item.routingKey, ROUTING);
    stable(item.deadLetterExchange);
    stable(item.deadLetterQueue);
    stable(item.deadLetterRoutingKey, ROUTING);
    if (ids.has(item.bindingId) || item.retryLayers.length > 15) throw new Error("worker_rabbit_topology_invalid");
    ids.add(item.bindingId);
    const delays = new Set<number>();
    for (const retry of item.retryLayers) {
      stable(retry.exchange);
      stable(retry.queue);
      stable(retry.routingKey, ROUTING);
      if (!Number.isSafeInteger(retry.delaySeconds) || retry.delaySeconds < 1 || retry.delaySeconds > 86_400 || delays.has(retry.delaySeconds)) throw new Error("worker_rabbit_topology_invalid");
      delays.add(retry.delaySeconds);
    }
  }
}

function retryHeaders(value: unknown, attempt: number): Readonly<Record<string, string | number>> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !Number.isSafeInteger(attempt) || attempt < 2 || attempt > 16) throw new Error("worker_rabbit_message_invalid");
  const input = value as Readonly<Record<string, unknown>>;
  const kind = input["x-ai-crm-kind"];
  const version = input["x-ai-crm-version"];
  if ((kind !== "event" && kind !== "job") || !Number.isSafeInteger(version) || (version as number) < 1 || (version as number) > 1_000) throw new Error("worker_rabbit_message_invalid");
  const output: Record<string, string | number> = { "x-ai-crm-delivery-attempt": attempt, "x-ai-crm-kind": kind, "x-ai-crm-version": version as number };
  const causationId = input["x-ai-crm-causation-id"];
  const traceparent = input["traceparent"];
  const tracestate = input["tracestate"];
  if (causationId !== undefined) {
    if (typeof causationId !== "string" || !UUID.test(causationId)) throw new Error("worker_rabbit_message_invalid");
    output["x-ai-crm-causation-id"] = causationId.toLowerCase();
  }
  if (traceparent !== undefined) {
    if (typeof traceparent !== "string" || !TRACEPARENT.test(traceparent)) throw new Error("worker_rabbit_message_invalid");
    output["traceparent"] = traceparent;
  }
  if (tracestate !== undefined) {
    if (typeof tracestate !== "string" || !TRACESTATE.test(tracestate)) throw new Error("worker_rabbit_message_invalid");
    output["tracestate"] = tracestate;
  }
  return output;
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined, code: string): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) throw new Error(code);
  let rejectAbort: ((reason: Error) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const listener = (): void => { rejectAbort?.(new Error(code)); };
  signal.addEventListener("abort", listener, { once: true });
  try { return await Promise.race([promise, aborted]); }
  finally { signal.removeEventListener("abort", listener); }
}

async function closeResources(channel: Channel, model: ChannelModel, signal?: AbortSignal): Promise<void> {
  const failures: unknown[] = [];
  try { await abortable(channel.close(), signal, "worker_rabbit_close_aborted"); }
  catch (error) { failures.push(error); }
  try { await abortable(model.close(), signal, "worker_rabbit_close_aborted"); }
  catch (error) { failures.push(error); }
  if (signal?.aborted === true) throw new Error("worker_rabbit_close_aborted");
  if (failures.length > 0) throw new AggregateError(failures, "worker_rabbit_close_failed");
}

async function connect(configuration: RabbitConnectionConfiguration): Promise<ChannelModel> {
  return amqpConnect({
    heartbeat: configuration.heartbeatSeconds,
    hostname: configuration.hostname,
    password: configuration.password,
    port: configuration.port,
    protocol: "amqps",
    username: configuration.username,
    vhost: configuration.vhost,
  }, {
    ca: [configuration.ca],
    cert: configuration.clientCertificate,
    key: configuration.clientKey,
    keepAlive: true,
    noDelay: true,
    rejectUnauthorized: true,
    servername: configuration.servername,
  });
}

async function acquireModel(
  configuration: RabbitConnectionConfiguration,
  connector: AmqplibConnector,
  signal?: AbortSignal,
): Promise<ChannelModel> {
  const pending = connector(configuration);
  try {
    return await abortable(pending, signal, "worker_rabbit_acquisition_aborted");
  } catch (error) {
    // A connector may complete after the application deadline. It must not
    // leave a model without an owner merely because cancellation won the race.
    void pending.then(async (model) => { await model.close(); }, () => undefined).catch(() => undefined);
    throw error;
  }
}

async function cleanupFailedAcquisition(
  model: ChannelModel,
  channels: readonly Channel[],
  signal?: AbortSignal,
): Promise<void> {
  const cleanup = Promise.allSettled([
    ...channels.map(async (channel) => { await channel.close(); }),
    model.close(),
  ]);
  if (signal?.aborted === true) {
    // Start forced resource termination, but do not let a stuck close hide the
    // acquisition cancellation from the composition deadline.
    void cleanup;
    return;
  }
  await abortable(cleanup, signal, "worker_rabbit_acquisition_aborted").catch(() => undefined);
}

export async function createAmqplibResourceRuntime(
  configuration: RabbitConnectionConfiguration,
  connector: AmqplibConnector = connect,
  signal?: AbortSignal,
): Promise<RabbitResourceRuntime> {
  const model = await acquireModel(configuration, connector, signal);
  let channel: Channel | undefined;
  let open = true;
  let blocked = false;
  const unavailable = (): void => { open = false; };
  model.on("blocked", () => { blocked = true; });
  model.on("unblocked", () => { blocked = false; });
  model.on("close", unavailable);
  model.on("error", unavailable);
  try {
    channel = await abortable(model.createChannel(), signal, "worker_rabbit_acquisition_aborted");
    channel.on("close", unavailable);
    channel.on("error", unavailable);
  } catch (error) {
    open = false;
    await cleanupFailedAcquisition(model, channel === undefined ? [] : [channel], signal);
    if (error instanceof Error && error.message === "worker_rabbit_acquisition_aborted") throw error;
    throw new Error("worker_rabbit_connection_failed");
  }
  const activeChannel = channel;
  return Object.freeze({
    async close(signal?: AbortSignal) {
      open = false;
      await closeResources(activeChannel, model, signal);
    },
    healthy: () => open && !blocked,
  });
}

class ConnectionState {
  private blocked = false;
  private readonly unavailable = new Set<() => void>();
  private open = true;
  public constructor(private readonly model: ChannelModel) {
    model.on("blocked", () => { this.blocked = true; });
    model.on("unblocked", () => { this.blocked = false; });
    model.on("close", () => { this.markClosed(); });
    model.on("error", () => { this.markClosed(); });
  }
  public healthy(): boolean { return this.open && !this.blocked; }
  public markClosed(): void {
    if (!this.open) return;
    this.open = false;
    for (const listener of this.unavailable) listener();
  }
  public onUnavailable(listener: () => void): void { this.unavailable.add(listener); }
}

interface PublishOperation {
  claimed: boolean;
  confirmed: boolean;
  readonly confirmation: Promise<void>;
  readonly messageId: string;
  reject: (error: Error) => void;
  resolve: () => void;
  returned: boolean;
  readonly transportPublicationId: string;
}

class ConfirmPort implements RabbitConfirmChannel {
  private backpressured = false;
  private open = true;
  private readonly operations: PublishOperation[] = [];
  private unavailableReported = false;
  public constructor(private readonly channel: ConfirmChannel, private readonly state: ConnectionState, private readonly onUnavailable?: () => void) {
    state.onUnavailable(() => { this.fail(); });
    channel.on("return", (message: Message) => {
      const headers: unknown = message.properties.headers;
      const transportPublicationId = typeof headers === "object" && headers !== null && !Array.isArray(headers)
        ? (headers as Readonly<Record<string, unknown>>)[TRANSPORT_PUBLICATION_HEADER]
        : undefined;
      const operation = typeof transportPublicationId === "string" && UUID.test(transportPublicationId)
        ? this.operations.find((candidate) => candidate.transportPublicationId === transportPublicationId && !candidate.returned)
        : undefined;
      if (operation === undefined) { this.fail(); return; }
      operation.returned = true;
    });
    channel.on("close", () => { this.fail(); });
    channel.on("error", () => { this.fail(); });
  }
  private fail(): void {
    if (!this.open) return;
    this.open = false;
    for (const operation of this.operations) {
      if (!operation.confirmed) operation.reject(new Error("worker_rabbit_publish_uncertain"));
    }
    if (!this.unavailableReported) {
      this.unavailableReported = true;
      this.onUnavailable?.();
    }
  }
  public async assertDurableExchange(exchange: string, type: "direct" | "topic"): Promise<void> {
    stable(exchange);
    await this.channel.assertExchange(exchange, type, { autoDelete: false, durable: true });
  }
  public publishMandatory(exchange: string, routingKey: string, payload: Uint8Array, properties: Readonly<Record<string, unknown>>): boolean {
    if (!this.healthy() || this.backpressured) throw new Error("worker_rabbit_publish_unavailable");
    const messageId = properties["messageId"];
    if (typeof messageId !== "string" || !UUID.test(messageId)) throw new Error("worker_rabbit_message_invalid");
    let resolve = (): void => undefined;
    let reject = (error: Error): void => { throw error; };
    const confirmation = new Promise<void>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
    const transportPublicationId = randomUUID();
    const operation: PublishOperation = { claimed: false, confirmation, confirmed: false, messageId: messageId.toLowerCase(), reject, resolve, returned: false, transportPublicationId };
    this.operations.push(operation);
    try {
      const inputHeaders: unknown = properties["headers"];
      const headers = typeof inputHeaders === "object" && inputHeaders !== null && !Array.isArray(inputHeaders)
        ? { ...(inputHeaders as Readonly<Record<string, unknown>>), [TRANSPORT_PUBLICATION_HEADER]: transportPublicationId }
        : { [TRANSPORT_PUBLICATION_HEADER]: transportPublicationId };
      const writable = this.channel.publish(exchange, routingKey, Buffer.from(payload), { ...(properties as Options.Publish), headers, mandatory: true, messageId: operation.messageId, persistent: true }, (error: unknown) => {
        operation.confirmed = true;
        if (error) operation.reject(new Error("worker_rabbit_publish_uncertain"));
        else operation.resolve();
      });
      this.backpressured = !writable;
      return writable;
    } catch {
      this.operations.splice(this.operations.indexOf(operation), 1);
      throw new Error("worker_rabbit_publish_uncertain");
    }
  }
  public async waitForDrain(): Promise<void> {
    if (!this.healthy() || !this.backpressured) throw new Error("worker_rabbit_publish_unavailable");
    const controller = new AbortController();
    try {
      await Promise.race([
        once(this.channel, "drain", { signal: controller.signal }).then(() => undefined),
        once(this.channel, "close", { signal: controller.signal }).then(() => { throw new Error("worker_rabbit_publish_uncertain"); }),
        once(this.channel, "error", { signal: controller.signal }).then(() => { throw new Error("worker_rabbit_publish_uncertain"); }),
      ]);
      this.backpressured = false;
    } finally {
      controller.abort();
    }
  }
  public async waitForConfirms(): Promise<void> {
    if (!this.healthy()) throw new Error("worker_rabbit_publish_unavailable");
    const operation = this.operations.find((candidate) => !candidate.claimed);
    if (operation === undefined) throw new Error("worker_rabbit_publish_uncertain");
    operation.claimed = true;
    try {
      await operation.confirmation;
    } catch {
      const index = this.operations.indexOf(operation);
      if (index >= 0) this.operations.splice(index, 1);
      throw new Error("worker_rabbit_publish_uncertain");
    }
    if (!this.healthy()) throw new Error("worker_rabbit_publish_uncertain");
  }
  public takeReturned(messageId: string): boolean {
    const normalized = messageId.toLowerCase();
    const index = this.operations.findIndex((candidate) => candidate.claimed && candidate.confirmed && candidate.messageId === normalized);
    if (index < 0) throw new Error("worker_rabbit_publish_uncertain");
    const [operation] = this.operations.splice(index, 1);
    return operation?.returned === true;
  }
  public healthy(): boolean { return this.open && this.state.healthy(); }
}

export async function createAmqplibPublisherAdapter(
  configuration: RabbitConnectionConfiguration,
  connector: AmqplibConnector = connect,
  signal?: AbortSignal,
): Promise<RabbitPublisherAdapter> {
  const model = await acquireModel(configuration, connector, signal);
  const state = new ConnectionState(model);
  let channel: ConfirmChannel | undefined;
  try {
    channel = await abortable(model.createConfirmChannel(), signal, "worker_rabbit_acquisition_aborted");
    const activeChannel = channel;
    const port = new ConfirmPort(activeChannel, state);
    return Object.freeze({
      channel: port,
      close: async (signal?: AbortSignal) => {
        state.markClosed();
        await closeResources(activeChannel, model, signal);
      },
      healthy: () => port.healthy(),
    });
  } catch (error) {
    state.markClosed();
    await cleanupFailedAcquisition(model, channel === undefined ? [] : [channel], signal);
    if (error instanceof Error && error.message === "worker_rabbit_acquisition_aborted") throw error;
    throw new Error("worker_rabbit_connection_failed");
  }
}

export interface AbortableRabbitConsumerAdapter extends RabbitConsumerAdapter {
  drain(signal?: AbortSignal): Promise<void>;
}

class ConsumerAdapter implements AbortableRabbitConsumerAdapter {
  public readonly bindingIds: () => readonly string[];
  public readonly concurrency: number;
  public readonly prefetch: number;
  private active = 0;
  private channelOpen = true;
  private consumers = new Map<string, string>();
  private inFlight = new Set<Promise<void>>();
  private runReject: ((reason: Error) => void) | undefined;
  private runResolve: (() => void) | undefined;
  private running = false;
  private stopping = false;
  private drainOperation: Promise<void> | undefined;
  private readonly retryPort: ConfirmPort;

  public constructor(
    private readonly model: ChannelModel,
    private readonly channel: Channel,
    retryChannel: ConfirmChannel,
    private readonly state: ConnectionState,
    private readonly topologies: readonly RabbitConsumerTopology[],
    prefetch: number,
    concurrency: number,
  ) {
    this.prefetch = prefetch;
    this.concurrency = concurrency;
    const bindingIds = Object.freeze(topologies.map(({ bindingId }) => bindingId));
    this.bindingIds = () => bindingIds;
    const failed = (): void => {
      this.channelOpen = false;
      this.runReject?.(new Error("worker_rabbit_consumer_unavailable"));
      void this.stopAcquisition().catch(() => { this.runReject?.(new Error("worker_rabbit_cancel_failed")); });
    };
    this.retryPort = new ConfirmPort(retryChannel, state, failed);
    channel.on("close", failed);
    channel.on("error", failed);
    model.on("blocked", () => { void this.stopAcquisition().finally(() => { failed(); }); });
    model.on("close", failed);
    model.on("error", failed);
  }

  public healthy(): boolean { return this.channelOpen && this.state.healthy() && this.retryPort.healthy() && !this.stopping; }
  public ready(signal: AbortSignal): void {
    if (signal.aborted || !this.healthy()) throw new Error("worker_rabbit_not_ready");
  }

  public async run(accept: (bindingId: string, message: RabbitDelivery) => Promise<void>, signal: AbortSignal): Promise<void> {
    if (this.running || !this.healthy()) throw new Error("worker_rabbit_consumer_unavailable");
    this.running = true;
    const completion = new Promise<void>((resolve, reject) => { this.runResolve = resolve; this.runReject = reject; });
    const abort = (): void => { void this.stopAcquisition().then(() => { this.runResolve?.(); }, () => { this.runReject?.(new Error("worker_rabbit_cancel_failed")); }); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      for (const topology of this.topologies) {
        const reply = await this.channel.consume(topology.queue, (message) => {
          if (message === null) {
            this.consumers.delete(topology.bindingId);
            if (this.stopping) return;
            this.stopping = true;
            this.runReject?.(new Error("worker_rabbit_consumer_cancelled"));
            return;
          }
          if (this.stopping) return;
          const execution = this.schedule(topology, message, accept);
          this.inFlight.add(execution);
          void execution.then(
            () => { this.inFlight.delete(execution); },
            () => {
              this.inFlight.delete(execution);
              this.stopping = true;
              this.runReject?.(new Error("worker_rabbit_delivery_failed"));
            },
          );
        }, { noAck: false });
        // Abort or failure may win while amqplib is registering. Never publish
        // a late consumer tag into the live set after acquisition has stopped.
        if (this.stopping || signal.aborted) await this.channel.cancel(reply.consumerTag);
        else this.consumers.set(topology.bindingId, reply.consumerTag);
      }
      if (signal.aborted) abort();
      await completion;
    } finally {
      signal.removeEventListener("abort", abort);
      this.runResolve = undefined;
      this.runReject = undefined;
      this.running = false;
    }
  }

  private async schedule(topology: RabbitConsumerTopology, message: ConsumeMessage, accept: (bindingId: string, message: RabbitDelivery) => Promise<void>): Promise<void> {
    while (!this.stopping && this.active >= this.concurrency) await Promise.race(this.inFlight);
    if (this.stopping) return;
    this.active += 1;
    try {
      const inputHeaders: unknown = message.properties.headers;
      const rawAttempt = typeof inputHeaders === "object" && inputHeaders !== null && !Array.isArray(inputHeaders)
        ? (inputHeaders as Readonly<Record<string, unknown>>)["x-ai-crm-delivery-attempt"]
        : undefined;
      const inputProperties = message.properties as unknown as Readonly<Record<string, unknown>>;
      const attempt = typeof rawAttempt === "number" ? rawAttempt : Number.NaN;
      const delivery: RabbitDelivery = {
        ack: () => { this.channel.ack(message); },
        attempt,
        body: message.content,
        deadLetter: () => { this.channel.nack(message, false, false); },
        retry: async (delaySeconds) => {
          const layer = topology.retryLayers.find((candidate) => candidate.delaySeconds === delaySeconds);
          if (!layer) throw new Error("worker_rabbit_retry_layer_missing");
          const messageId = inputProperties["messageId"];
          if (typeof messageId !== "string" || !UUID.test(messageId)) throw new Error("worker_rabbit_message_invalid");
          const appId = inputProperties["appId"];
          const correlationId = inputProperties["correlationId"];
          const messageType = inputProperties["type"];
          if (typeof appId !== "string" || appId.length > 256 || !SOURCE.test(appId) ||
            typeof correlationId !== "string" || !UUID.test(correlationId) ||
            typeof messageType !== "string" || messageType.length > 128 || !MESSAGE_TYPE.test(messageType)) throw new Error("worker_rabbit_message_invalid");
          const retryProperties: Record<string, unknown> = {
            appId,
            contentType: "application/json",
            correlationId: correlationId.toLowerCase(),
            headers: retryHeaders(inputHeaders, attempt + 1),
            messageId: messageId.toLowerCase(),
            type: messageType,
          };
          const writable = this.retryPort.publishMandatory(layer.exchange, layer.routingKey, message.content, {
            ...retryProperties,
          });
          if (!writable) await this.retryPort.waitForDrain();
          await this.retryPort.waitForConfirms();
          if (this.retryPort.takeReturned(messageId)) throw new Error("worker_rabbit_retry_unroutable");
        },
      };
      await accept(topology.bindingId, delivery);
    } finally {
      this.active -= 1;
    }
  }

  private async stopAcquisition(): Promise<void> {
    if (this.stopping && this.consumers.size === 0) return;
    this.stopping = true;
    const tags = [...this.consumers.values()];
    this.consumers.clear();
    await Promise.all(tags.map(async (tag) => { await this.channel.cancel(tag); }));
  }

  public async stop(): Promise<void> {
    await this.stopAcquisition();
    this.runResolve?.();
  }

  public drain(signal?: AbortSignal): Promise<void> {
    this.drainOperation ??= (async () => {
      try {
        await abortable(Promise.all([...this.inFlight]), signal, "worker_rabbit_drain_aborted");
      } catch (error) {
        this.channelOpen = false;
        this.state.markClosed();
        void this.channel.close().catch(() => undefined);
        void this.model.close().catch(() => undefined);
        throw error;
      }
      this.channelOpen = false;
      this.state.markClosed();
      await closeResources(this.channel, this.model, signal);
    })();
    return this.drainOperation;
  }
}

async function assertConsumerTopology(channel: Channel, retry: ConfirmChannel, topologies: readonly RabbitConsumerTopology[]): Promise<void> {
  for (const item of topologies) {
    await channel.assertExchange(item.exchange, item.exchangeType, { autoDelete: false, durable: true });
    await channel.assertExchange(item.deadLetterExchange, "direct", { autoDelete: false, durable: true });
    await channel.assertQueue(item.deadLetterQueue, { autoDelete: false, durable: true });
    await channel.bindQueue(item.deadLetterQueue, item.deadLetterExchange, item.deadLetterRoutingKey);
    await channel.assertQueue(item.queue, { autoDelete: false, deadLetterExchange: item.deadLetterExchange, deadLetterRoutingKey: item.deadLetterRoutingKey, durable: true });
    await channel.bindQueue(item.queue, item.exchange, item.routingKey);
    for (const layer of item.retryLayers) {
      await retry.assertExchange(layer.exchange, "direct", { autoDelete: false, durable: true });
      await retry.assertQueue(layer.queue, { autoDelete: false, deadLetterExchange: item.exchange, deadLetterRoutingKey: item.routingKey, durable: true, messageTtl: layer.delaySeconds * 1_000 });
      await retry.bindQueue(layer.queue, layer.exchange, layer.routingKey);
    }
  }
}

export async function createAmqplibConsumerAdapter(
  configuration: RabbitConnectionConfiguration,
  topologies: readonly RabbitConsumerTopology[],
  limits: { readonly concurrency: number; readonly prefetch: number },
  connector: AmqplibConnector = connect,
  signal?: AbortSignal,
): Promise<AbortableRabbitConsumerAdapter> {
  const ownedTopologies = copyTopologies(topologies);
  validateTopologies(ownedTopologies);
  if (!Number.isSafeInteger(limits.prefetch) || limits.prefetch < 1 || limits.prefetch > 10_000 || !Number.isSafeInteger(limits.concurrency) || limits.concurrency < 1 || limits.concurrency > limits.prefetch) throw new Error("worker_rabbit_limits_invalid");
  const model = await acquireModel(configuration, connector, signal);
  const state = new ConnectionState(model);
  const acquiredChannels: Channel[] = [];
  try {
    const channel = await abortable(model.createChannel(), signal, "worker_rabbit_acquisition_aborted");
    acquiredChannels.push(channel);
    const retryChannel = await abortable(model.createConfirmChannel(), signal, "worker_rabbit_acquisition_aborted");
    acquiredChannels.push(retryChannel);
    await abortable(channel.prefetch(limits.prefetch, false), signal, "worker_rabbit_acquisition_aborted");
    await abortable(assertConsumerTopology(channel, retryChannel, ownedTopologies), signal, "worker_rabbit_acquisition_aborted");
    return new ConsumerAdapter(model, channel, retryChannel, state, ownedTopologies, limits.prefetch, limits.concurrency);
  } catch (error) {
    state.markClosed();
    await cleanupFailedAcquisition(model, acquiredChannels, signal);
    if (error instanceof Error && error.message === "worker_rabbit_acquisition_aborted") throw error;
    throw new Error("worker_rabbit_topology_unavailable");
  }
}
