const DEFAULT_LIMITS: TelemetryLimits = {
  maxArrayLength: 20,
  maxDepth: 5,
  maxFields: 30,
  maxStringLength: 256,
};

const SENSITIVE_KEY =
  /(?:authorization|cookie|token|secret|password|passwd|session|credential|(?:api|private|public)[_-]?key|body|payload|sql|query|email|phone|mobile|address|id[_-]?card)/iu;
const SENSITIVE_VALUE =
  /(?:bearer\s+[a-z0-9._~+/=-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/iu;

export interface TelemetryLimits {
  readonly maxArrayLength: number;
  readonly maxDepth: number;
  readonly maxFields: number;
  readonly maxStringLength: number;
}

export type SafeTelemetryValue =
  | boolean
  | number
  | string
  | null
  | readonly SafeTelemetryValue[]
  | { readonly [key: string]: SafeTelemetryValue };

export interface SanitizeOptions {
  readonly allowedKeys?: readonly string[];
  readonly limits?: Partial<TelemetryLimits>;
}

interface State {
  readonly limits: TelemetryLimits;
  readonly seen: WeakSet<object>;
}

function limitedText(value: string, maxLength: number): string {
  if (SENSITIVE_VALUE.test(value)) {
    return "[REDACTED]";
  }
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength)}[TRUNCATED]`;
}

function objectType(value: object): string {
  const ownDescriptor = Object.getOwnPropertyDescriptor(value, "constructor");
  const ownConstructor: unknown = ownDescriptor !== undefined && "value" in ownDescriptor
    ? ownDescriptor.value as unknown
    : undefined;
  const prototype = Object.getPrototypeOf(value) as object | null;
  const prototypeDescriptor = prototype === null
    ? undefined
    : Object.getOwnPropertyDescriptor(prototype, "constructor");
  const prototypeConstructor: unknown = prototypeDescriptor !== undefined && "value" in prototypeDescriptor
    ? prototypeDescriptor.value as unknown
    : undefined;
  const constructor = ownConstructor ?? prototypeConstructor;
  if (typeof constructor === "function" && constructor.name.length > 0) {
    return constructor.name.slice(0, 64);
  }
  return "Object";
}

function sanitizeValue(value: unknown, depth: number, state: State): SafeTelemetryValue {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : "[NON_FINITE_NUMBER]";
  }
  if (typeof value === "string") {
    return limitedText(value, state.limits.maxStringLength);
  }
  if (typeof value === "bigint") {
    return limitedText(value.toString(), state.limits.maxStringLength);
  }
  if (typeof value !== "object") {
    return `[${typeof value}]`;
  }
  if (value instanceof Error) {
    const result: Record<string, SafeTelemetryValue> = {
      type: limitedText(value.name || "Error", 64),
    };
    if ("cause" in value && value.cause !== undefined) {
      result["cause"] = sanitizeValue(value.cause, depth + 1, state);
    }
    return result;
  }
  if (depth >= state.limits.maxDepth) {
    return "[MAX_DEPTH]";
  }
  if (state.seen.has(value)) {
    return "[CIRCULAR]";
  }
  state.seen.add(value);

  if (Array.isArray(value)) {
    const items = value
      .slice(0, state.limits.maxArrayLength)
      .map((item) => sanitizeValue(item, depth + 1, state));
    if (value.length > state.limits.maxArrayLength) {
      items.push("[TRUNCATED]");
    }
    return items;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    return { type: objectType(value) };
  }

  const result: Record<string, SafeTelemetryValue> = {};
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).sort().slice(0, state.limits.maxFields);
  for (const key of keys) {
    if (SENSITIVE_KEY.test(key)) {
      result[key] = "[REDACTED]";
      continue;
    }
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      result[key] = "[ACCESSOR]";
      continue;
    }
    result[key] = sanitizeValue(descriptor.value, depth + 1, state);
  }
  if (Object.keys(descriptors).length > state.limits.maxFields) {
    result["truncated"] = true;
  }
  return result;
}

export function sanitizeTelemetry(
  value: unknown,
  options: SanitizeOptions = {},
): SafeTelemetryValue {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  let sanitized: SafeTelemetryValue;
  try {
    sanitized = sanitizeValue(value, 0, {
      limits,
      seen: new WeakSet<object>(),
    });
  } catch {
    sanitized = { type: "Unknown" };
  }
  if (
    options.allowedKeys === undefined ||
    sanitized === null ||
    Array.isArray(sanitized) ||
    typeof sanitized !== "object"
  ) {
    return sanitized;
  }
  const allowed = new Set(options.allowedKeys);
  return Object.fromEntries(
    Object.entries(sanitized).filter(([key]) => allowed.has(key)),
  );
}
