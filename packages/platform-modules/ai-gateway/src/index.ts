export const packageId = "@ai-crm/platform-ai-gateway" as const;
export { AiGatewayError, type AiGatewayErrorCode } from "./errors.js";
export { createAiGatewayService } from "./service.js";
export type {
  AiActor, AiAuthorizationRequest, AiAuthorizer, AiBudgetPort, AiCallRecord, AiGatewayService, AiModelAdapter, AiModelAdapterResult,
  AiProposal, AiProposalConfirmation, AiUseCaseRegistration, ConfirmAiProposalCommand, InvokeAiCommand, JsonValue,
} from "./types.js";
