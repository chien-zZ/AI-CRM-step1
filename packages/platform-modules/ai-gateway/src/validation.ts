import { createHash } from "node:crypto";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { AiGatewayError } from "./errors.js";
import type { AiActor, AiUseCaseRegistration, ConfirmAiProposalCommand, InvokeAiCommand, JsonValue } from "./types.js";

const ID = /^[a-z][a-z0-9_.-]{2,127}$/u;
const VERSION = /^[a-z0-9][a-z0-9_.:-]{0,127}$/u;
const REFERENCE = /^[A-Za-z0-9_.:@/-]{1,255}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TRACE = /^(?!0{32})[0-9a-f]{32}$/u;
const FORBIDDEN_KEY = /(authorization|cookie|credential|password|prompt|request|response|secret|session|token)/iu;
const FORBIDDEN_SCHEMA_KEYWORDS = new Set(["$dynamicRef", "$dynamicAnchor", "contentEncoding", "contentMediaType"]);
const invalid = (code: "ai_data_policy_rejected" | "ai_invalid_input" = "ai_invalid_input"): never => { throw new AiGatewayError(code); };
const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) => descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.enumerable)) invalid();
  return value as Record<string, unknown>;
};
const inspectPlainData = (value: unknown, depth = 0): void => {
  if (depth > 20) invalid("ai_data_policy_rejected");
  if (value === null || typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 1000) invalid("ai_data_policy_rejected");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)] ?? invalid("ai_data_policy_rejected");
      if (descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.enumerable) invalid("ai_data_policy_rejected");
      inspectPlainData(descriptor.value, depth + 1);
    }
    if (Object.keys(descriptors).some((key) => key !== "length" && !/^(0|[1-9]\d*)$/u.test(key))) invalid("ai_data_policy_rejected");
    return;
  }
  if (typeof value !== "object") invalid();
  const candidate = object(value);
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  if (Object.keys(descriptors).length > 1000) invalid("ai_data_policy_rejected");
  for (const descriptor of Object.values(descriptors)) {
    if (descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.enumerable) invalid("ai_data_policy_rejected");
    inspectPlainData(descriptor.value, depth + 1);
  }
};
const exact = (value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> => {
  const candidate = object(value);
  const keys = Object.keys(candidate);
  if (required.some((key) => !Object.hasOwn(candidate, key)) || keys.some((key) => !required.includes(key) && !optional.includes(key))) invalid();
  return candidate;
};
const string = (value: unknown, pattern: RegExp): string => typeof value === "string" && pattern.test(value) ? value : invalid();
const positive = (value: unknown, maximum: number): number => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= maximum ? value as number : invalid();

const actor = (value: unknown): AiActor => {
  const input = exact(value, ["actorId", "actorType"], ["assignmentId", "workforcePersonId"]);
  const actorType = input.actorType === "authenticated_subject" || input.actorType === "system" ? input.actorType : invalid();
  return {
    actorId: string(input.actorId, REFERENCE),
    actorType,
    ...(input.assignmentId === undefined ? {} : { assignmentId: string(input.assignmentId, UUID).toLowerCase() }),
    ...(input.workforcePersonId === undefined ? {} : { workforcePersonId: string(input.workforcePersonId, UUID).toLowerCase() }),
  };
};

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  if (value === null || typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return JSON.stringify(value);
  return invalid();
};
export const digest = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");

const scanSchema = (value: unknown, depth = 0): void => {
  if (depth > 20) invalid();
  if (Array.isArray(value)) {
    for (const item of value) scanSchema(item, depth + 1);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_SCHEMA_KEYWORDS.has(key) || (key === "$ref" && (typeof item !== "string" || !item.startsWith("#/")))) invalid();
    if (key === "properties" && typeof item === "object" && item !== null && Object.keys(item as Record<string, unknown>).some((name) => FORBIDDEN_KEY.test(name))) invalid("ai_data_policy_rejected");
    scanSchema(item, depth + 1);
  }
};

const compile = (schema: Readonly<Record<string, unknown>>): ValidateFunction => {
  inspectPlainData(schema);
  if (JSON.stringify(schema).length > 64_000 || schema.$schema !== "https://json-schema.org/draft/2020-12/schema") invalid();
  scanSchema(schema);
  try {
    return new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  } catch (error) {
    throw new AiGatewayError("ai_invalid_input", { cause: error });
  }
};

export interface ValidatedUseCase {
  readonly inputValidator: ValidateFunction;
  readonly outputValidator: ValidateFunction;
  readonly registration: AiUseCaseRegistration;
}

export function validateUseCase(value: unknown): ValidatedUseCase {
  const input = exact(value, ["budgetPolicyVersion", "dataPolicyVersion", "enabled", "inputSchema", "inputSchemaVersion", "maximumCostMicros", "maximumInputBytes", "maximumOutputBytes", "maximumTokens", "modelPolicyVersion", "outputSchema", "outputSchemaVersion", "ownerReference", "promptPolicyVersion", "proposalTtlMs", "requiresHumanConfirmation", "useCaseId", "version"]);
  if (input.version !== 1 || input.requiresHumanConfirmation !== true || typeof input.enabled !== "boolean") invalid();
  const enabled = input.enabled as boolean;
  const registration: AiUseCaseRegistration = {
    budgetPolicyVersion: string(input.budgetPolicyVersion, VERSION), dataPolicyVersion: string(input.dataPolicyVersion, VERSION), enabled,
    inputSchema: object(input.inputSchema), inputSchemaVersion: string(input.inputSchemaVersion, VERSION), maximumCostMicros: positive(input.maximumCostMicros, 1_000_000_000),
    maximumInputBytes: positive(input.maximumInputBytes, 1_000_000), maximumOutputBytes: positive(input.maximumOutputBytes, 1_000_000), maximumTokens: positive(input.maximumTokens, 1_000_000),
    modelPolicyVersion: string(input.modelPolicyVersion, VERSION), outputSchema: object(input.outputSchema), outputSchemaVersion: string(input.outputSchemaVersion, VERSION),
    ownerReference: string(input.ownerReference, REFERENCE), promptPolicyVersion: string(input.promptPolicyVersion, VERSION), proposalTtlMs: positive(input.proposalTtlMs, 86_400_000),
    requiresHumanConfirmation: true, useCaseId: string(input.useCaseId, ID), version: 1,
  };
  return { inputValidator: compile(registration.inputSchema), outputValidator: compile(registration.outputSchema), registration };
}

const safeJson = (value: unknown, maximumBytes: number): JsonValue => {
  let encoded: string;
  try { inspectPlainData(value); encoded = canonical(value); } catch (error) { throw new AiGatewayError("ai_invalid_input", { cause: error }); }
  if (Buffer.byteLength(encoded, "utf8") > maximumBytes) invalid("ai_data_policy_rejected");
  const scan = (item: unknown, depth = 0): void => {
    if (depth > 20) invalid("ai_data_policy_rejected");
    if (Array.isArray(item)) { if (item.length > 1000) invalid("ai_data_policy_rejected"); for (const child of item) scan(child, depth + 1); return; }
    if (typeof item === "object" && item !== null) {
      const keys = Object.keys(item);
      if (keys.length > 1000 || keys.some((key) => FORBIDDEN_KEY.test(key))) invalid("ai_data_policy_rejected");
      for (const child of Object.values(item)) scan(child, depth + 1);
      return;
    }
    if (item !== null && typeof item !== "boolean" && typeof item !== "string" && (typeof item !== "number" || !Number.isFinite(item))) invalid();
  };
  scan(value);
  return JSON.parse(encoded) as JsonValue;
};

export function validateInvocation(value: unknown, useCase: ValidatedUseCase): InvokeAiCommand {
  const input = exact(value, ["actor", "dataClassification", "input", "operationId", "resourceReference", "traceId", "useCaseId"]);
  if (input.dataClassification !== "synthetic") invalid("ai_data_policy_rejected");
  const structuredInput = safeJson(input.input, useCase.registration.maximumInputBytes);
  if (!useCase.inputValidator(structuredInput)) invalid("ai_data_policy_rejected");
  return { actor: actor(input.actor), dataClassification: "synthetic", input: structuredInput, operationId: string(input.operationId, UUID).toLowerCase(), resourceReference: string(input.resourceReference, REFERENCE), traceId: string(input.traceId, TRACE).toLowerCase(), useCaseId: string(input.useCaseId, ID) };
}

export function validateOutput(value: unknown, useCase: ValidatedUseCase): JsonValue {
  let output: JsonValue;
  try { output = safeJson(value, useCase.registration.maximumOutputBytes); }
  catch (error) { throw new AiGatewayError("ai_output_invalid", { cause: error }); }
  if (!useCase.outputValidator(output)) throw new AiGatewayError("ai_output_invalid");
  return output;
}

export function validateConfirmation(value: unknown): ConfirmAiProposalCommand {
  const input = exact(value, ["actor", "decision", "operationId", "proposalId", "resourceReference", "traceId", "useCaseId"], ["reason"]);
  const decision = input.decision === "accepted" || input.decision === "modified" || input.decision === "rejected" ? input.decision : invalid();
  const reason = input.reason === undefined ? undefined : typeof input.reason === "string" && input.reason.length > 0 && input.reason.length <= 500 ? input.reason : invalid();
  const confirmingActor = actor(input.actor);
  if (confirmingActor.actorType !== "authenticated_subject") invalid();
  return { actor: confirmingActor, decision, operationId: string(input.operationId, UUID).toLowerCase(), proposalId: string(input.proposalId, UUID).toLowerCase(), ...(reason === undefined ? {} : { reason }), resourceReference: string(input.resourceReference, REFERENCE), traceId: string(input.traceId, TRACE).toLowerCase(), useCaseId: string(input.useCaseId, ID) };
}

export const invocationFingerprint = (command: InvokeAiCommand): string => {
  return digest({ actor: command.actor, dataClassification: command.dataClassification, input: command.input, operationId: command.operationId, resourceReference: command.resourceReference, useCaseId: command.useCaseId });
};
