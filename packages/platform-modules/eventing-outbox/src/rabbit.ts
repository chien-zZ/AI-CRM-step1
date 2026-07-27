import { EventingError } from "./errors.js";
import type { ConfirmingMessageTransport, JobEnvelope, OutboxPublication } from "./types.js";
import { validateMessageEnvelope } from "./validation.js";

export interface RabbitConfirmChannel {
  assertDurableExchange(exchange: string, type: "direct" | "topic"): Promise<void>;
  publishMandatory(exchange: string, routingKey: string, payload: Uint8Array, properties: Readonly<Record<string, unknown>>): boolean;
  waitForDrain(): Promise<void>;
  waitForConfirms(): Promise<void>;
  takeReturned(messageId: string): boolean;
}
export interface RabbitRoute { readonly messageKind: "event" | "job"; readonly messageType: string; readonly messageVersion: number; readonly routingKey: string; }
export interface RabbitPublisherTopology { readonly exchange: string; readonly exchangeType: "direct" | "topic"; readonly routes: readonly RabbitRoute[]; }
const NAME=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u; const ROUTE=/^[A-Za-z0-9*#][A-Za-z0-9._*#:-]{0,254}$/u;

export async function createRabbitConfirmTransport(channel: RabbitConfirmChannel, topology: RabbitPublisherTopology): Promise<ConfirmingMessageTransport> {
  if (!NAME.test(topology.exchange) || topology.routes.length < 1 || topology.routes.length > 1000 || topology.routes.some((route) => !ROUTE.test(route.routingKey))) throw new EventingError("eventing_invalid_input");
  const routes = new Map(topology.routes.map((route) => [`${route.messageKind}\0${route.messageType}\0${String(route.messageVersion)}`, route.routingKey]));
  if (routes.size !== topology.routes.length) throw new EventingError("eventing_invalid_input");
  await channel.assertDurableExchange(topology.exchange, topology.exchangeType);
  return Object.freeze({ async publish(message: OutboxPublication) {
    const route=routes.get(`${message.messageKind}\0${message.messageType}\0${String(message.messageVersion)}`); if(!route) throw new EventingError("eventing_invalid_input");
    const writable=channel.publishMandatory(topology.exchange,route,Buffer.from(message.payload),{persistent:true,contentType:"application/json",messageId:message.messageId,type:message.messageType,correlationId:message.correlationId,appId:message.producer,headers:{"x-ai-crm-kind":message.messageKind,"x-ai-crm-version":message.messageVersion,"x-ai-crm-publish-attempt":message.attempt,"x-ai-crm-delivery-attempt":1,...(message.causationId===undefined?{}:{"x-ai-crm-causation-id":message.causationId}),...(message.traceparent===undefined?{}:{traceparent:message.traceparent}),...(message.tracestate===undefined?{}:{tracestate:message.tracestate})}});
    if(!writable) await channel.waitForDrain();
    try { await channel.waitForConfirms(); } catch { throw new EventingError("eventing_storage_unavailable",true); }
    if(channel.takeReturned(message.messageId)) throw new EventingError("eventing_storage_unavailable",true);
  } });
}

export interface RabbitDelivery { readonly body: Uint8Array; readonly attempt: number; ack(): void; retry(delaySeconds: number): Promise<void>; deadLetter(): void; }
export async function handleRabbitDelivery(delivery: RabbitDelivery, consume: (envelope: unknown, attempt: number, timeoutMs: number) => Promise<void>, options: { readonly eventPolicy: { readonly maxAttempts: number; readonly backoffSeconds: readonly number[]; readonly timeoutMs: number }; readonly classify: (error: unknown) => "retryable" | "terminal" }): Promise<void> {
  let retryPolicy=options.eventPolicy;
  try { if(delivery.body.byteLength>262144||!Number.isInteger(delivery.attempt)||delivery.attempt<1) throw new EventingError("eventing_invalid_input");const message=validateMessageEnvelope(JSON.parse(Buffer.from(delivery.body).toString("utf8")) as unknown);if(message.messageKind==="job"){const policy=(message.envelope as JobEnvelope).policy;retryPolicy={maxAttempts:policy.maxAttempts,backoffSeconds:policy.backoffSeconds,timeoutMs:policy.timeoutMs};}else if(!Number.isInteger(retryPolicy.maxAttempts)||retryPolicy.maxAttempts<1||retryPolicy.maxAttempts>16||retryPolicy.backoffSeconds.length!==retryPolicy.maxAttempts-1||retryPolicy.backoffSeconds.some((value)=>!Number.isInteger(value)||value<1||value>86400)||!Number.isInteger(retryPolicy.timeoutMs)||retryPolicy.timeoutMs<100||retryPolicy.timeoutMs>900000)throw new EventingError("eventing_invalid_input");if(delivery.attempt>retryPolicy.maxAttempts){delivery.deadLetter();return;}await consume(message.envelope,delivery.attempt,retryPolicy.timeoutMs); delivery.ack(); }
  catch(error){ if(options.classify(error)==="retryable"&&delivery.attempt<retryPolicy.maxAttempts){await delivery.retry(retryPolicy.backoffSeconds[delivery.attempt-1]??1);delivery.ack();}else delivery.deadLetter(); }
}
