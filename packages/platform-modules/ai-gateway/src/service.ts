import { randomUUID } from "node:crypto";
import { AiGatewayError } from "./errors.js";
import type { AiBudgetPort, AiCallRecord, AiCallRecordPort, AiGatewayService, AiModelAdapter, AiProposal, AiProposalConfirmation, AiAuthorizer, AiSuccessfulCallRecord } from "./types.js";
import { digest, invocationFingerprint, validateConfirmation, validateInvocation, validateOutput, validateUseCase, type ValidatedUseCase } from "./validation.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const portObject = (value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new AiGatewayError("ai_adapter_unavailable", { retryable: true });
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  if (required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) => !required.includes(key) && !optional.includes(key))) throw new AiGatewayError("ai_adapter_unavailable", { retryable: true });
  const result: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.enumerable) throw new AiGatewayError("ai_adapter_unavailable", { retryable: true });
    result[key] = descriptor.value;
  }
  return result;
};

interface StoredProposal {
  readonly expiresAt: string;
  readonly outputDigest: string;
  readonly proposalId: string;
  readonly resourceReference: string;
  readonly useCaseId: string;
}

const cloneInvocation = (value: { readonly call: AiSuccessfulCallRecord; readonly proposal: AiProposal; readonly replayed: boolean }) => structuredClone(value);
const cloneConfirmation = (value: AiProposalConfirmation) => structuredClone(value);

export function createAiGatewayService(options: {
  readonly adapter: AiModelAdapter;
  readonly authorizer: AiAuthorizer;
  readonly budget: AiBudgetPort;
  readonly callRecords: AiCallRecordPort;
  readonly clock?: () => Date;
  readonly id?: () => string;
  readonly useCases: readonly unknown[];
}): AiGatewayService {
  const clock = options.clock ?? (() => new Date());
  const id = options.id ?? randomUUID;
  const useCases = new Map<string, ValidatedUseCase>();
  for (const candidate of options.useCases) {
    const validated = validateUseCase(candidate);
    if (useCases.has(validated.registration.useCaseId)) throw new AiGatewayError("ai_invalid_input");
    useCases.set(validated.registration.useCaseId, validated);
  }
  const operations = new Map<string, { readonly fingerprint: string; readonly result: Promise<{ readonly call: AiSuccessfulCallRecord; readonly proposal: AiProposal; readonly replayed: boolean }> }>();
  const proposals = new Map<string, StoredProposal>();
  const confirmations = new Map<string, { readonly fingerprint: string; readonly result: Promise<AiProposalConfirmation> }>();

  const authorize = async (request: Parameters<AiAuthorizer["authorize"]>[0]): Promise<{ readonly allowed: boolean; readonly decisionId: string }> => {
    let decision: unknown;
    try { decision = await options.authorizer.authorize(request); }
    catch (error) { throw new AiGatewayError("ai_adapter_unavailable", { cause: error, retryable: true }); }
    const parsed = portObject(decision, ["allowed", "decisionId"]);
    if (typeof parsed.allowed !== "boolean" || typeof parsed.decisionId !== "string" || !UUID.test(parsed.decisionId)) {
      throw new AiGatewayError("ai_adapter_unavailable", { retryable: true });
    }
    return { allowed: parsed.allowed, decisionId: parsed.decisionId.toLowerCase() };
  };
  const recordCall = async (call: AiCallRecord): Promise<void> => {
    try { await options.callRecords.record(structuredClone(call)); }
    catch (error) { throw new AiGatewayError("ai_adapter_unavailable", { cause: error, retryable: true }); }
  };
  const failedCategory = (error: AiGatewayError): "authorization" | "budget" | "dependency" | "output" | "policy" => {
    if (error.code === "ai_use_case_unavailable" || error.code === "ai_confirmation_denied") return "authorization";
    if (error.code === "ai_budget_exceeded") return "budget";
    if (error.code === "ai_output_invalid") return "output";
    if (error.code === "ai_data_policy_rejected" || error.code === "ai_invalid_input") return "policy";
    return "dependency";
  };

  return {
    async invoke(input) {
      const rawInput: unknown = input;
      if (typeof rawInput !== "object" || rawInput === null || Array.isArray(rawInput) || (Object.getPrototypeOf(rawInput) !== Object.prototype && Object.getPrototypeOf(rawInput) !== null)) throw new AiGatewayError("ai_invalid_input");
      const useCaseDescriptor = Object.getOwnPropertyDescriptor(rawInput, "useCaseId");
      if (useCaseDescriptor === undefined || useCaseDescriptor.get !== undefined || useCaseDescriptor.set !== undefined || !useCaseDescriptor.enumerable) throw new AiGatewayError("ai_invalid_input");
      const requestedId = useCaseDescriptor.value as unknown;
      if (typeof requestedId !== "string") throw new AiGatewayError("ai_invalid_input");
      const useCase = useCases.get(requestedId);
      if (useCase === undefined || !useCase.registration.enabled) throw new AiGatewayError("ai_use_case_unavailable");
      const command = validateInvocation(input, useCase);
      const fingerprint = invocationFingerprint(command);
      const prior = operations.get(command.operationId);
      if (prior !== undefined) {
        if (prior.fingerprint !== fingerprint) throw new AiGatewayError("ai_operation_conflict");
        const replay = await prior.result;
        return cloneInvocation({ ...replay, replayed: true });
      }

      const execution = (async (): Promise<{ readonly call: AiSuccessfulCallRecord; readonly proposal: AiProposal; readonly replayed: boolean }> => {
        const callId = id();
        if (!UUID.test(callId)) throw new AiGatewayError("ai_adapter_unavailable", { retryable: true });
        const inputDigest = digest(command.input);
        let adapterAttempts = 0;
        let authorizationDecisionId: string | undefined;
        try {
        const authorization = await authorize({ action: "ai:invoke", actor: command.actor, resourceReference: command.resourceReference, useCaseId: command.useCaseId });
        authorizationDecisionId = authorization.decisionId;
        if (!authorization.allowed) throw new AiGatewayError("ai_use_case_unavailable");
        let budget: unknown;
        try {
          budget = await options.budget.reserve({ budgetPolicyVersion: useCase.registration.budgetPolicyVersion, maximumCostMicros: useCase.registration.maximumCostMicros, maximumTokens: useCase.registration.maximumTokens, operationId: command.operationId, useCaseId: command.useCaseId });
        } catch (error) {
          throw new AiGatewayError("ai_adapter_unavailable", { cause: error, retryable: true });
        }
        const typedBudget = portObject(budget, ["allowed"], ["reservationId"]);
        if (typeof typedBudget.allowed !== "boolean") throw new AiGatewayError("ai_adapter_unavailable", { retryable: true });
        if (!typedBudget.allowed) {
          if (typedBudget.reservationId !== undefined) throw new AiGatewayError("ai_adapter_unavailable", { retryable: true });
          throw new AiGatewayError("ai_budget_exceeded");
        }
        if (typeof typedBudget.reservationId !== "string" || typedBudget.reservationId.length < 1 || typedBudget.reservationId.length > 128) throw new AiGatewayError("ai_adapter_unavailable", { retryable: true });

        let adapterResult: unknown;
        try {
          adapterAttempts += 1;
          adapterResult = await options.adapter.invoke({ dataClassification: command.dataClassification, modelPolicyVersion: useCase.registration.modelPolicyVersion, operationId: command.operationId, structuredInput: command.input, useCaseId: command.useCaseId });
        } catch (error) {
          if (error instanceof AiGatewayError) throw error;
          throw new AiGatewayError("ai_adapter_unavailable", { cause: error, retryable: true });
        }
        let typedResult: Record<string, unknown>;
        try { typedResult = portObject(adapterResult, ["adapterVersion", "structuredOutput", "usage"]); }
        catch (error) { throw new AiGatewayError("ai_output_invalid", { cause: error }); }
        const usage: unknown = typedResult.usage;
        let typedUsage: Record<string, unknown>;
        try { typedUsage = portObject(usage, ["costMicros", "inputTokens", "outputTokens"]); }
        catch (error) { throw new AiGatewayError("ai_output_invalid", { cause: error }); }
        if (!Number.isSafeInteger(typedUsage.inputTokens) || (typedUsage.inputTokens as number) < 0 || !Number.isSafeInteger(typedUsage.outputTokens) || (typedUsage.outputTokens as number) < 0 || !Number.isSafeInteger(typedUsage.costMicros) || (typedUsage.costMicros as number) < 0 || (typedUsage.inputTokens as number) + (typedUsage.outputTokens as number) > useCase.registration.maximumTokens || (typedUsage.costMicros as number) > useCase.registration.maximumCostMicros || typeof typedResult.adapterVersion !== "string" || !/^[a-z0-9][a-z0-9_.:-]{0,127}$/u.test(typedResult.adapterVersion)) {
          throw new AiGatewayError("ai_output_invalid");
        }
        const output = validateOutput(typedResult.structuredOutput, useCase);
        const now = clock();
        if (!Number.isFinite(now.getTime())) throw new AiGatewayError("ai_adapter_unavailable", { retryable: true });
        const proposalId = id();
        if (!UUID.test(proposalId)) throw new AiGatewayError("ai_adapter_unavailable", { retryable: true });
        const outputDigest = digest(output);
        const expiresAt = new Date(now.getTime() + useCase.registration.proposalTtlMs).toISOString();
        const proposal: AiProposal = { authoritative: false, expiresAt, output, outputDigest, outputSchemaVersion: useCase.registration.outputSchemaVersion, proposalId: proposalId.toLowerCase(), requiresHumanConfirmation: true, useCaseId: command.useCaseId, version: 1 };
        const call: AiSuccessfulCallRecord = {
          actorReference: command.actor.actorId, actorType: command.actor.actorType, adapterAttempts, adapterVersion: typedResult.adapterVersion, authorizationDecisionId,
          budgetPolicyVersion: useCase.registration.budgetPolicyVersion, callId: callId.toLowerCase(), costMicros: typedUsage.costMicros as number,
          dataClassification: "synthetic", dataPolicyVersion: useCase.registration.dataPolicyVersion, inputDigest, inputSchemaVersion: useCase.registration.inputSchemaVersion,
          modelPolicyVersion: useCase.registration.modelPolicyVersion, operationId: command.operationId, outputDigest, outputSchemaVersion: useCase.registration.outputSchemaVersion,
          promptPolicyVersion: useCase.registration.promptPolicyVersion, proposalId: proposal.proposalId, resourceReference: command.resourceReference, status: "proposal_created",
          tokenUsage: { input: typedUsage.inputTokens as number, output: typedUsage.outputTokens as number, total: (typedUsage.inputTokens as number) + (typedUsage.outputTokens as number) }, traceId: command.traceId, useCaseId: command.useCaseId, version: 1,
        };
        await recordCall(call);
        proposals.set(proposal.proposalId, { expiresAt, outputDigest, proposalId: proposal.proposalId, resourceReference: command.resourceReference, useCaseId: command.useCaseId });
        return { call, proposal, replayed: false };
        } catch (error) {
          const failure = error instanceof AiGatewayError ? error : new AiGatewayError("ai_adapter_unavailable", { cause: error, retryable: true });
          const call: AiCallRecord = {
            actorReference: command.actor.actorId, actorType: command.actor.actorType, adapterAttempts,
            ...(authorizationDecisionId === undefined ? {} : { authorizationDecisionId }), budgetPolicyVersion: useCase.registration.budgetPolicyVersion,
            callId: callId.toLowerCase(), dataClassification: "synthetic", dataPolicyVersion: useCase.registration.dataPolicyVersion,
            errorCategory: failedCategory(failure), errorCode: failure.code, inputDigest, inputSchemaVersion: useCase.registration.inputSchemaVersion,
            modelPolicyVersion: useCase.registration.modelPolicyVersion, operationId: command.operationId, outputSchemaVersion: useCase.registration.outputSchemaVersion,
            promptPolicyVersion: useCase.registration.promptPolicyVersion, resourceReference: command.resourceReference, retryable: failure.retryable,
            status: "failed", traceId: command.traceId, useCaseId: command.useCaseId, version: 1,
          };
          await recordCall(call);
          throw failure;
        }
      })();
      operations.set(command.operationId, { fingerprint, result: execution });
      return cloneInvocation(await execution);
    },

    async confirm(input) {
      const command = validateConfirmation(input);
      const fingerprint = digest({ actor: command.actor, decision: command.decision, operationId: command.operationId, proposalId: command.proposalId, ...(command.reason === undefined ? {} : { reason: command.reason }), resourceReference: command.resourceReference, useCaseId: command.useCaseId });
      const prior = confirmations.get(command.operationId);
      if (prior !== undefined) {
        if (prior.fingerprint !== fingerprint) throw new AiGatewayError("ai_operation_conflict");
        return cloneConfirmation(await prior.result);
      }
      const proposal = proposals.get(command.proposalId);
      if (proposal === undefined || proposal.useCaseId !== command.useCaseId || proposal.resourceReference !== command.resourceReference) throw new AiGatewayError("ai_proposal_unavailable");
      if (useCases.get(command.useCaseId)?.registration.enabled !== true) throw new AiGatewayError("ai_use_case_unavailable");
      const now = clock();
      if (!Number.isFinite(now.getTime())) throw new AiGatewayError("ai_adapter_unavailable", { retryable: true });
      if (now.getTime() >= new Date(proposal.expiresAt).getTime()) throw new AiGatewayError("ai_proposal_expired");
      const execution = (async (): Promise<AiProposalConfirmation> => {
        const authorization = await authorize({ action: "ai:confirm", actor: command.actor, resourceReference: command.resourceReference, useCaseId: command.useCaseId });
        if (!authorization.allowed) throw new AiGatewayError("ai_confirmation_denied");
        const confirmationId = id();
        if (!UUID.test(confirmationId)) throw new AiGatewayError("ai_adapter_unavailable", { retryable: true });
        return {
          actor: command.actor, authoritative: false, confirmationId: confirmationId.toLowerCase(), confirmedAt: now.toISOString(), decision: command.decision,
          domainCommandExecuted: false, operationId: command.operationId, proposalId: command.proposalId, ...(command.reason === undefined ? {} : { reason: command.reason }),
          resourceReference: command.resourceReference, traceId: command.traceId, useCaseId: command.useCaseId, version: 1,
        };
      })();
      confirmations.set(command.operationId, { fingerprint, result: execution });
      try { return cloneConfirmation(await execution); }
      catch (error) { confirmations.delete(command.operationId); throw error; }
    },
  };
}
