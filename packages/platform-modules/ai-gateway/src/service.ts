import { randomUUID } from "node:crypto";
import { AiGatewayError } from "./errors.js";
import type { AiBudgetPort, AiCallRecord, AiGatewayService, AiModelAdapter, AiProposal, AiProposalConfirmation, AiAuthorizer } from "./types.js";
import { digest, invocationFingerprint, validateConfirmation, validateInvocation, validateOutput, validateUseCase, type ValidatedUseCase } from "./validation.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface StoredProposal {
  readonly expiresAt: string;
  readonly outputDigest: string;
  readonly proposalId: string;
  readonly resourceReference: string;
  readonly useCaseId: string;
}

const cloneInvocation = (value: { readonly call: AiCallRecord; readonly proposal: AiProposal; readonly replayed: boolean }) => structuredClone(value);
const cloneConfirmation = (value: AiProposalConfirmation) => structuredClone(value);

export function createAiGatewayService(options: {
  readonly adapter: AiModelAdapter;
  readonly authorizer: AiAuthorizer;
  readonly budget: AiBudgetPort;
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
  const operations = new Map<string, { readonly fingerprint: string; readonly result: Promise<{ readonly call: AiCallRecord; readonly proposal: AiProposal; readonly replayed: boolean }> }>();
  const proposals = new Map<string, StoredProposal>();
  const confirmations = new Map<string, { readonly fingerprint: string; readonly result: Promise<AiProposalConfirmation> }>();

  const authorize = async (request: Parameters<AiAuthorizer["authorize"]>[0]): Promise<void> => {
    let decision: unknown;
    try { decision = await options.authorizer.authorize(request); }
    catch (error) { throw new AiGatewayError("ai_adapter_unavailable", { cause: error, retryable: true }); }
    if (typeof decision !== "object" || decision === null || Array.isArray(decision) || Object.keys(decision).some((key) => key !== "allowed" && key !== "decisionId") || typeof (decision as { allowed?: unknown }).allowed !== "boolean" || typeof (decision as { decisionId?: unknown }).decisionId !== "string" || !UUID.test((decision as { decisionId: string }).decisionId)) {
      throw new AiGatewayError("ai_adapter_unavailable", { retryable: true });
    }
    if (!(decision as { allowed: boolean }).allowed) throw new AiGatewayError(request.action === "ai:confirm" ? "ai_confirmation_denied" : "ai_use_case_unavailable");
  };

  return {
    async invoke(input) {
      const rawInput: unknown = input;
      const requestedId = typeof rawInput === "object" && rawInput !== null ? (rawInput as { readonly useCaseId?: unknown }).useCaseId : undefined;
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

      const execution = (async (): Promise<{ readonly call: AiCallRecord; readonly proposal: AiProposal; readonly replayed: boolean }> => {
        await authorize({ action: "ai:invoke", actor: command.actor, resourceReference: command.resourceReference, useCaseId: command.useCaseId });
        let budget: unknown;
        try {
          budget = await options.budget.reserve({ budgetPolicyVersion: useCase.registration.budgetPolicyVersion, maximumCostMicros: useCase.registration.maximumCostMicros, maximumTokens: useCase.registration.maximumTokens, operationId: command.operationId, useCaseId: command.useCaseId });
        } catch (error) {
          throw new AiGatewayError("ai_adapter_unavailable", { cause: error, retryable: true });
        }
        if (typeof budget !== "object" || budget === null || Array.isArray(budget) || Object.keys(budget).some((key) => key !== "allowed" && key !== "reservationId")) throw new AiGatewayError("ai_adapter_unavailable", { retryable: true });
        const typedBudget = budget as { readonly allowed?: unknown; readonly reservationId?: unknown };
        if (typeof typedBudget.allowed !== "boolean") throw new AiGatewayError("ai_adapter_unavailable", { retryable: true });
        if (!typedBudget.allowed) {
          if (typedBudget.reservationId !== undefined) throw new AiGatewayError("ai_adapter_unavailable", { retryable: true });
          throw new AiGatewayError("ai_budget_exceeded");
        }
        if (typeof typedBudget.reservationId !== "string" || typedBudget.reservationId.length < 1 || typedBudget.reservationId.length > 128) throw new AiGatewayError("ai_adapter_unavailable", { retryable: true });

        let adapterResult: unknown;
        try {
          adapterResult = await options.adapter.invoke({ dataClassification: command.dataClassification, modelPolicyVersion: useCase.registration.modelPolicyVersion, operationId: command.operationId, structuredInput: command.input, useCaseId: command.useCaseId });
        } catch (error) {
          if (error instanceof AiGatewayError) throw error;
          throw new AiGatewayError("ai_adapter_unavailable", { cause: error, retryable: true });
        }
        if (typeof adapterResult !== "object" || adapterResult === null || Array.isArray(adapterResult) || Object.keys(adapterResult).some((key) => key !== "adapterVersion" && key !== "structuredOutput" && key !== "usage")) throw new AiGatewayError("ai_output_invalid");
        const typedResult = adapterResult as { readonly adapterVersion?: unknown; readonly structuredOutput?: unknown; readonly usage?: unknown };
        const usage: unknown = typedResult.usage;
        if (typeof usage !== "object" || usage === null || Array.isArray(usage) || Object.keys(usage).some((key) => key !== "costMicros" && key !== "inputTokens" && key !== "outputTokens")) throw new AiGatewayError("ai_output_invalid");
        const typedUsage = usage as { readonly costMicros?: unknown; readonly inputTokens?: unknown; readonly outputTokens?: unknown };
        if (!Number.isSafeInteger(typedUsage.inputTokens) || (typedUsage.inputTokens as number) < 0 || !Number.isSafeInteger(typedUsage.outputTokens) || (typedUsage.outputTokens as number) < 0 || !Number.isSafeInteger(typedUsage.costMicros) || (typedUsage.costMicros as number) < 0 || (typedUsage.inputTokens as number) + (typedUsage.outputTokens as number) > useCase.registration.maximumTokens || (typedUsage.costMicros as number) > useCase.registration.maximumCostMicros || typeof typedResult.adapterVersion !== "string" || !/^[a-z0-9][a-z0-9_.:-]{0,127}$/u.test(typedResult.adapterVersion)) {
          throw new AiGatewayError("ai_output_invalid");
        }
        const output = validateOutput(typedResult.structuredOutput, useCase);
        const now = clock();
        if (!Number.isFinite(now.getTime())) throw new AiGatewayError("ai_adapter_unavailable", { retryable: true });
        const proposalId = id();
        const callId = id();
        if (!UUID.test(proposalId) || !UUID.test(callId)) throw new AiGatewayError("ai_adapter_unavailable", { retryable: true });
        const outputDigest = digest(output);
        const expiresAt = new Date(now.getTime() + useCase.registration.proposalTtlMs).toISOString();
        const proposal: AiProposal = { authoritative: false, expiresAt, output, outputDigest, outputSchemaVersion: useCase.registration.outputSchemaVersion, proposalId: proposalId.toLowerCase(), requiresHumanConfirmation: true, useCaseId: command.useCaseId, version: 1 };
        const call: AiCallRecord = {
          adapterVersion: typedResult.adapterVersion, budgetPolicyVersion: useCase.registration.budgetPolicyVersion, callId: callId.toLowerCase(), costMicros: typedUsage.costMicros as number,
          dataClassification: "synthetic", dataPolicyVersion: useCase.registration.dataPolicyVersion, inputDigest: digest(command.input), inputSchemaVersion: useCase.registration.inputSchemaVersion,
          modelPolicyVersion: useCase.registration.modelPolicyVersion, operationId: command.operationId, outputDigest, outputSchemaVersion: useCase.registration.outputSchemaVersion,
          promptPolicyVersion: useCase.registration.promptPolicyVersion, proposalId: proposal.proposalId, resourceReference: command.resourceReference, status: "proposal_created",
          tokenUsage: { input: typedUsage.inputTokens as number, output: typedUsage.outputTokens as number, total: (typedUsage.inputTokens as number) + (typedUsage.outputTokens as number) }, traceId: command.traceId, useCaseId: command.useCaseId, version: 1,
        };
        proposals.set(proposal.proposalId, { expiresAt, outputDigest, proposalId: proposal.proposalId, resourceReference: command.resourceReference, useCaseId: command.useCaseId });
        return { call, proposal, replayed: false };
      })();
      operations.set(command.operationId, { fingerprint, result: execution });
      try { return cloneInvocation(await execution); }
      catch (error) { operations.delete(command.operationId); throw error; }
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
        await authorize({ action: "ai:confirm", actor: command.actor, resourceReference: command.resourceReference, useCaseId: command.useCaseId });
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
