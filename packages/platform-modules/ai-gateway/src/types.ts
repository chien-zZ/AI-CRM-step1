import type { AiGatewayErrorCode } from "./errors.js";

export type JsonValue = boolean | number | string | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface AiActor {
  readonly actorId: string;
  readonly actorType: "authenticated_subject" | "system";
  readonly assignmentId?: string;
  readonly workforcePersonId?: string;
}

export interface AiUseCaseRegistration {
  readonly budgetPolicyVersion: string;
  readonly dataPolicyVersion: string;
  readonly enabled: boolean;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly inputSchemaVersion: string;
  readonly maximumCostMicros: number;
  readonly maximumInputBytes: number;
  readonly maximumOutputBytes: number;
  readonly maximumTokens: number;
  readonly modelPolicyVersion: string;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchemaVersion: string;
  readonly ownerReference: string;
  readonly promptPolicyVersion: string;
  readonly proposalTtlMs: number;
  readonly requiresHumanConfirmation: true;
  readonly useCaseId: string;
  readonly version: 1;
}

export interface AiAuthorizationRequest {
  readonly action: "ai:confirm" | "ai:invoke";
  readonly actor: AiActor;
  readonly resourceReference: string;
  readonly useCaseId: string;
}

export interface AiAuthorizer {
  authorize(request: AiAuthorizationRequest): Promise<{ readonly allowed: boolean; readonly decisionId: string }>;
}

export interface AiBudgetPort {
  reserve(input: {
    readonly budgetPolicyVersion: string;
    readonly maximumCostMicros: number;
    readonly maximumTokens: number;
    readonly operationId: string;
    readonly useCaseId: string;
  }): Promise<{ readonly allowed: boolean; readonly reservationId?: string }>;
}

export interface AiModelAdapterResult {
  readonly adapterVersion: string;
  readonly structuredOutput: JsonValue;
  readonly usage: { readonly costMicros: number; readonly inputTokens: number; readonly outputTokens: number };
}

export interface AiModelAdapter {
  invoke(input: {
    readonly dataClassification: "synthetic";
    readonly modelPolicyVersion: string;
    readonly operationId: string;
    readonly structuredInput: JsonValue;
    readonly useCaseId: string;
  }): Promise<AiModelAdapterResult>;
}

export interface InvokeAiCommand {
  readonly actor: AiActor;
  readonly dataClassification: "synthetic";
  readonly input: JsonValue;
  readonly operationId: string;
  readonly resourceReference: string;
  readonly traceId: string;
  readonly useCaseId: string;
}

export interface AiProposal {
  readonly authoritative: false;
  readonly expiresAt: string;
  readonly output: JsonValue;
  readonly outputDigest: string;
  readonly outputSchemaVersion: string;
  readonly proposalId: string;
  readonly requiresHumanConfirmation: true;
  readonly useCaseId: string;
  readonly version: 1;
}

interface AiCallRecordBase {
  readonly actorReference: string;
  readonly actorType: AiActor["actorType"];
  readonly adapterAttempts: number;
  readonly authorizationDecisionId?: string;
  readonly budgetPolicyVersion: string;
  readonly callId: string;
  readonly dataClassification: "synthetic";
  readonly dataPolicyVersion: string;
  readonly inputDigest: string;
  readonly inputSchemaVersion: string;
  readonly modelPolicyVersion: string;
  readonly operationId: string;
  readonly outputSchemaVersion: string;
  readonly promptPolicyVersion: string;
  readonly resourceReference: string;
  readonly traceId: string;
  readonly useCaseId: string;
  readonly version: 1;
}

export interface AiSuccessfulCallRecord extends AiCallRecordBase {
  readonly adapterVersion: string;
  readonly authorizationDecisionId: string;
  readonly costMicros: number;
  readonly outputDigest: string;
  readonly proposalId: string;
  readonly status: "proposal_created";
  readonly tokenUsage: { readonly input: number; readonly output: number; readonly total: number };
}

export interface AiFailedCallRecord extends AiCallRecordBase {
  readonly errorCategory: "authorization" | "budget" | "dependency" | "output" | "policy";
  readonly errorCode: AiGatewayErrorCode;
  readonly retryable: boolean;
  readonly status: "failed";
}

export type AiCallRecord = AiSuccessfulCallRecord | AiFailedCallRecord;

export interface AiCallRecordPort {
  record(call: AiCallRecord): Promise<void>;
}

export interface ConfirmAiProposalCommand {
  readonly actor: AiActor;
  readonly decision: "accepted" | "modified" | "rejected";
  readonly operationId: string;
  readonly proposalId: string;
  readonly reason?: string;
  readonly resourceReference: string;
  readonly traceId: string;
  readonly useCaseId: string;
}

export interface AiProposalConfirmation {
  readonly actor: AiActor;
  readonly authoritative: false;
  readonly confirmationId: string;
  readonly confirmedAt: string;
  readonly decision: "accepted" | "modified" | "rejected";
  readonly domainCommandExecuted: false;
  readonly operationId: string;
  readonly proposalId: string;
  readonly reason?: string;
  readonly resourceReference: string;
  readonly traceId: string;
  readonly useCaseId: string;
  readonly version: 1;
}

export interface AiGatewayService {
  confirm(command: ConfirmAiProposalCommand): Promise<AiProposalConfirmation>;
  invoke(command: InvokeAiCommand): Promise<{ readonly call: AiSuccessfulCallRecord; readonly proposal: AiProposal; readonly replayed: boolean }>;
}
