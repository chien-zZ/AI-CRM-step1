import { AsyncLocalStorage } from "node:async_hooks";

export interface CorrelationContext {
  readonly requestId?: string;
  readonly messageId?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly attempt?: number;
}

const contextStorage = new AsyncLocalStorage<Readonly<CorrelationContext>>();
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function normalizeCorrelationContext(
  context: CorrelationContext,
): Readonly<CorrelationContext> {
  const result: {
    attempt?: number;
    causationId?: string;
    correlationId?: string;
    messageId?: string;
    requestId?: string;
  } = {};
  if (Number.isSafeInteger(context.attempt) && Number(context.attempt) > 0) {
    result.attempt = Number(context.attempt);
  }
  if (context.causationId !== undefined && IDENTIFIER.test(context.causationId)) {
    result.causationId = context.causationId;
  }
  if (context.correlationId !== undefined && IDENTIFIER.test(context.correlationId)) {
    result.correlationId = context.correlationId;
  }
  if (context.messageId !== undefined && IDENTIFIER.test(context.messageId)) {
    result.messageId = context.messageId;
  }
  if (context.requestId !== undefined && IDENTIFIER.test(context.requestId)) {
    result.requestId = context.requestId;
  }
  return Object.freeze(result);
}

export function runWithCorrelationContext<T>(
  context: CorrelationContext,
  callback: () => T,
): T {
  return contextStorage.run(normalizeCorrelationContext(context), callback);
}

export function getCorrelationContext(): Readonly<CorrelationContext> {
  return contextStorage.getStore() ?? Object.freeze({});
}
