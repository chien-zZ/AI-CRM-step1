import { AuthorizationDeniedError, AuthorizationPersistenceError, AuthorizationUnavailableError } from "./errors.js";
import { canonicalizeAuthorizationPolicy } from "./postgres-persistence.js";
import type {
  AuthorizationDecision,
  AuthorizationPolicyPublication,
  AuthorizationPolicyPublicationAuditRecord,
  AuthorizationPolicyPublicationActor,
  AuthorizationSubjectContext,
  PermissionRequest,
  ProtectedAuthorizationPolicyPublisher,
  ProtectedAuthorizationPolicyPublisherOptions,
  ProtectedPublishAuthorizationPolicyCommand,
} from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TRACE_ID = /^(?!0{32})[0-9a-f]{32}$/u;
const ACTOR_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,254}$/u;
const REASON_CODE = /^[a-z][a-z0-9_]{0,63}$/u;
const RESOURCE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;
const ACTION = /^[a-z][a-z0-9-]*$/u;
const CONTRACT_VERSION = "authorization-policy.v1";
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const POLICY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

const invalid = (): never => { throw new AuthorizationPersistenceError("authorization_policy_invalid"); };
const plainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

function snapshotData(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))) return value;
  if (depth > 32 || typeof value !== "object") return invalid();
  if (seen.has(value)) return invalid();
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) return invalid();
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Object.keys(descriptors).filter((key) => key !== "length");
      if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) return invalid();
      return keys.map((key) => {
        const descriptor = descriptors[key];
        if (!descriptor || !("value" in descriptor)) return invalid();
        return snapshotData(descriptor.value as unknown, seen, depth + 1);
      });
    }
    if (!plainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) return invalid();
    const result: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!("value" in descriptor)) return invalid();
      result[key] = snapshotData(descriptor.value as unknown, seen, depth + 1);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!plainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in descriptors)) || Object.keys(descriptors).some((key) => !allowed.has(key))) return invalid();
  const result: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor)) return invalid();
    result[key] = descriptor.value;
  }
  return result;
}

function bindMethod(port: unknown, name: string): (...args: never[]) => unknown {
  if ((typeof port !== "object" || port === null) && typeof port !== "function") return invalid();
  let owner: object | null = port;
  while (owner !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, name);
    if (descriptor !== undefined) {
      if (!("value" in descriptor)) return invalid();
      const candidate: unknown = descriptor.value;
      if (typeof candidate !== "function") return invalid();
      // Reflect.apply supplies the explicit receiver without reading a possibly trapped candidate.bind property.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const bound: unknown = Reflect.apply(Function.prototype.bind, candidate, [port]);
      if (typeof bound !== "function") return invalid();
      return Object.freeze(bound) as (...args: never[]) => unknown;
    }
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return invalid();
}

const uuid = (value: unknown): string => typeof value === "string" && UUID.test(value) ? value.toLowerCase() : invalid();

function subject(value: unknown): AuthorizationSubjectContext {
  const input = exactRecord(value, ["activeAssignmentIds", "workforcePersonId"], ["selectedAssignmentId"]);
  if (!Array.isArray(input["activeAssignmentIds"]) || Object.getPrototypeOf(input["activeAssignmentIds"]) !== Array.prototype) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input["activeAssignmentIds"]);
  const keys = Object.keys(descriptors).filter((key) => key !== "length");
  if (keys.length !== input["activeAssignmentIds"].length || keys.some((key, index) => key !== String(index))) return invalid();
  const activeAssignmentIds = keys.map((key) => {
    const descriptor = descriptors[key];
    return descriptor && "value" in descriptor ? uuid(descriptor.value) : invalid();
  });
  if (activeAssignmentIds.length > 128 || new Set(activeAssignmentIds).size !== activeAssignmentIds.length) return invalid();
  const selectedAssignmentId = input["selectedAssignmentId"] === undefined ? undefined : uuid(input["selectedAssignmentId"]);
  if (selectedAssignmentId !== undefined && !activeAssignmentIds.includes(selectedAssignmentId)) return invalid();
  return Object.freeze({
    activeAssignmentIds: Object.freeze(activeAssignmentIds),
    ...(selectedAssignmentId === undefined ? {} : { selectedAssignmentId }),
    workforcePersonId: uuid(input["workforcePersonId"]),
  });
}

function actor(value: unknown): AuthorizationPolicyPublicationActor {
  const input = exactRecord(value, ["actorId", "actorType", "subject"]);
  if (input["actorType"] !== "authenticated_subject" || typeof input["actorId"] !== "string" || !ACTOR_ID.test(input["actorId"])) return invalid();
  return Object.freeze({ actorId: input["actorId"], actorType: "authenticated_subject", subject: subject(input["subject"]) });
}

function permission(value: unknown): PermissionRequest {
  const input = exactRecord(value, ["action", "resource"], ["resourceContext"]);
  if (typeof input["resource"] !== "string" || input["resource"].length > 128 || !RESOURCE.test(input["resource"]) ||
    typeof input["action"] !== "string" || input["action"].length > 64 || !ACTION.test(input["action"]) || input["resourceContext"] !== undefined) return invalid();
  return Object.freeze({ action: input["action"], resource: input["resource"] });
}

function command(value: ProtectedPublishAuthorizationPolicyCommand): ProtectedPublishAuthorizationPolicyCommand {
  const input = exactRecord(value, ["actor", "auditOperationIds", "contractVersion", "operationId", "publicationId", "publishedAt", "reason", "snapshot", "traceId"], ["expectedPreviousVersion"]);
  const auditOperationIds = exactRecord(input["auditOperationIds"], ["authorizationDenied", "authorizationFailed", "publicationFailed"]);
  const reason = exactRecord(input["reason"], ["code"]);
  const publishedAt = input["publishedAt"];
  const publishedDate = new Date(typeof publishedAt === "string" ? publishedAt : Number.NaN);
  if (input["contractVersion"] !== CONTRACT_VERSION || typeof input["traceId"] !== "string" || !TRACE_ID.test(input["traceId"]) ||
    typeof publishedAt !== "string" || !TIMESTAMP.test(publishedAt) || Number.isNaN(publishedDate.getTime()) || publishedDate.toISOString() !== publishedAt ||
    typeof reason["code"] !== "string" || !REASON_CODE.test(reason["code"])) return invalid();
  const snapshot = canonicalizeAuthorizationPolicy(snapshotData(input["snapshot"]) as ProtectedPublishAuthorizationPolicyCommand["snapshot"]);
  const expectedPreviousVersion = input["expectedPreviousVersion"];
  if (expectedPreviousVersion !== undefined && expectedPreviousVersion !== null &&
    (typeof expectedPreviousVersion !== "string" || !POLICY_VERSION.test(expectedPreviousVersion))) return invalid();
  const operationId = uuid(input["operationId"]);
  const normalizedAuditOperationIds = Object.freeze({
    authorizationDenied: uuid(auditOperationIds["authorizationDenied"]),
    authorizationFailed: uuid(auditOperationIds["authorizationFailed"]),
    publicationFailed: uuid(auditOperationIds["publicationFailed"]),
  });
  if (new Set([operationId, ...Object.values(normalizedAuditOperationIds)]).size !== 4) return invalid();
  return Object.freeze({
    actor: actor(input["actor"]), auditOperationIds: normalizedAuditOperationIds, contractVersion: CONTRACT_VERSION, operationId,
    ...(expectedPreviousVersion === undefined ? {} : { expectedPreviousVersion }),
    publicationId: uuid(input["publicationId"]), publishedAt,
    reason: Object.freeze({ code: reason["code"] }), snapshot, traceId: input["traceId"],
  });
}

function allowedDecision(value: Readonly<AuthorizationDecision>): Readonly<AuthorizationDecision> {
  const input = exactRecord(value, ["allowed", "decisionId", "evaluatedAt", "policyVersion", "reason"]);
  const evaluatedAt = input["evaluatedAt"];
  const evaluatedDate = new Date(typeof evaluatedAt === "string" ? evaluatedAt : Number.NaN);
  if (typeof input["allowed"] !== "boolean" || !input["allowed"] || input["reason"] !== "allowed" ||
    typeof input["decisionId"] !== "string" || !UUID.test(input["decisionId"]) ||
    typeof evaluatedAt !== "string" || !TIMESTAMP.test(evaluatedAt) || Number.isNaN(evaluatedDate.getTime()) || evaluatedDate.toISOString() !== evaluatedAt ||
    typeof input["policyVersion"] !== "string" || !POLICY_VERSION.test(input["policyVersion"])) {
    throw new AuthorizationUnavailableError();
  }
  return Object.freeze({
    allowed: true,
    decisionId: input["decisionId"].toLowerCase(),
    evaluatedAt,
    policyVersion: input["policyVersion"],
    reason: "allowed",
  });
}

function auditRecord(
  input: ProtectedPublishAuthorizationPolicyCommand,
  auditOperationId: string,
  stage: AuthorizationPolicyPublicationAuditRecord["stage"],
  result: AuthorizationPolicyPublicationAuditRecord["result"],
  authorizationDecisionId?: string,
): AuthorizationPolicyPublicationAuditRecord {
  return Object.freeze({
    action: "authorization.policy.publish",
    actor: Object.freeze({
      actorId: input.actor.actorId,
      actorType: input.actor.actorType,
      ...(input.actor.subject.selectedAssignmentId === undefined ? {} : { assignmentId: input.actor.subject.selectedAssignmentId }),
      workforcePersonId: input.actor.subject.workforcePersonId,
    }),
    auditOperationId,
    ...(authorizationDecisionId === undefined ? {} : { authorizationDecisionId: authorizationDecisionId.toLowerCase() }),
    managementOperationId: input.operationId,
    policyVersion: input.snapshot.version,
    publicationId: input.publicationId,
    reason: input.reason,
    result,
    stage,
    traceId: input.traceId,
  });
}

async function recordAudit(recordMethod: ProtectedAuthorizationPolicyPublisherOptions["audit"]["record"], record: AuthorizationPolicyPublicationAuditRecord): Promise<void> {
  try { await recordMethod(record); }
  catch { throw new AuthorizationUnavailableError(); }
}

export function createProtectedAuthorizationPolicyPublisher(
  input: ProtectedAuthorizationPolicyPublisherOptions,
): ProtectedAuthorizationPolicyPublisher {
  let options: Record<string, unknown>;
  try { options = exactRecord(input, ["audit", "authorizer", "permission", "publisher"]); }
  catch { return invalid(); }
  let configured: Readonly<{
    audit: ProtectedAuthorizationPolicyPublisherOptions["audit"]["record"];
    authorize: ProtectedAuthorizationPolicyPublisherOptions["authorizer"]["requireAllowed"];
    permission: PermissionRequest;
    publish: ProtectedAuthorizationPolicyPublisherOptions["publisher"]["publish"];
  }>;
  try {
    configured = Object.freeze({
      audit: bindMethod(options["audit"], "record") as ProtectedAuthorizationPolicyPublisherOptions["audit"]["record"],
      authorize: bindMethod(options["authorizer"], "requireAllowed") as ProtectedAuthorizationPolicyPublisherOptions["authorizer"]["requireAllowed"],
      permission: permission(options["permission"]),
      publish: bindMethod(options["publisher"], "publish") as ProtectedAuthorizationPolicyPublisherOptions["publisher"]["publish"],
    });
  } catch { return invalid(); }
  return Object.freeze({
    async publish(inputCommand: ProtectedPublishAuthorizationPolicyCommand): Promise<AuthorizationPolicyPublication> {
      let validated: ProtectedPublishAuthorizationPolicyCommand;
      try { validated = command(inputCommand); }
      catch (error) {
        if (error instanceof AuthorizationPersistenceError) throw error;
        return invalid();
      }
      let decision: Readonly<AuthorizationDecision>;
      try {
        decision = allowedDecision(await configured.authorize(
          validated.actor.subject,
          configured.permission,
          Object.freeze({ managementOperationId: validated.operationId, traceId: validated.traceId }),
        ));
      }
      catch (error) {
        if (error instanceof AuthorizationDeniedError) {
          if (!UUID.test(error.decisionId)) {
            await recordAudit(configured.audit, auditRecord(validated, validated.auditOperationIds.authorizationFailed, "authorization", "failed"));
            throw new AuthorizationUnavailableError();
          }
          await recordAudit(configured.audit, auditRecord(validated, validated.auditOperationIds.authorizationDenied, "authorization", "denied", error.decisionId));
          throw error;
        }
        await recordAudit(configured.audit, auditRecord(validated, validated.auditOperationIds.authorizationFailed, "authorization", "failed"));
        throw new AuthorizationUnavailableError();
      }
      try {
        const published = await configured.publish(validated);
        await recordAudit(configured.audit, auditRecord(validated, validated.operationId, "publication", "succeeded", decision.decisionId));
        return published;
      } catch (error) {
        if (error instanceof AuthorizationUnavailableError) throw error;
        await recordAudit(configured.audit, auditRecord(validated, validated.auditOperationIds.publicationFailed, "publication", "failed", decision.decisionId));
        if (error instanceof AuthorizationPersistenceError) throw error;
        throw new AuthorizationUnavailableError();
      }
    },
  });
}
