import { describe, expect, it, vi } from "vitest";
import { AiGatewayError, createAiGatewayService, type AiBudgetPort, type AiUseCaseRegistration } from "./index.js";
import { createFakeModelAdapter } from "./testing.js";

const traceId = "1234567890abcdef1234567890abcdef";
const actor = { actorId: "subject.synthetic", actorType: "authenticated_subject" as const };
const inputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  additionalProperties: false,
  properties: { syntheticText: { maxLength: 100, type: "string" } },
  required: ["syntheticText"],
  type: "object",
} as const;
const outputSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  additionalProperties: false,
  properties: { proposal: { maxLength: 100, type: "string" } },
  required: ["proposal"],
  type: "object",
} as const;
const useCase: AiUseCaseRegistration = {
  budgetPolicyVersion: "budget.v1", dataPolicyVersion: "synthetic.v1", enabled: true, inputSchema, inputSchemaVersion: "input.v1",
  maximumCostMicros: 1000, maximumInputBytes: 1024, maximumOutputBytes: 1024, maximumTokens: 100,
  modelPolicyVersion: "fake.v1", outputSchema, outputSchemaVersion: "output.v1", ownerReference: "platform:synthetic-owner",
  promptPolicyVersion: "prompt-reference.v1", proposalTtlMs: 60_000, requiresHumanConfirmation: true, useCaseId: "platform.synthetic.proposal", version: 1,
};
const result = { adapterVersion: "fake.v1", structuredOutput: { proposal: "synthetic proposal" }, usage: { costMicros: 10, inputTokens: 3, outputTokens: 5 } } as const;
const metadata = () => ({ actor, dataClassification: "synthetic" as const, input: { syntheticText: "fixture" }, operationId: crypto.randomUUID(), resourceReference: "synthetic:1", traceId, useCaseId: useCase.useCaseId });

function setup(options: { readonly allowed?: boolean; readonly now?: Date; readonly steps?: Parameters<typeof createFakeModelAdapter>[0][string] } = {}) {
  let now = options.now ?? new Date("2026-07-26T08:00:00.000Z");
  let sequence = 1;
  const id = () => `10000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`;
  const authorizer = { authorize: vi.fn(() => Promise.resolve({ allowed: options.allowed ?? true, decisionId: crypto.randomUUID() })) };
  const budget = { reserve: vi.fn<AiBudgetPort["reserve"]>(() => Promise.resolve({ allowed: true, reservationId: "synthetic-budget-1" })) };
  const adapter = createFakeModelAdapter({ [useCase.useCaseId]: options.steps ?? [{ kind: "result", result }, { kind: "result", result }, { kind: "result", result }] });
  return { adapter, authorizer, budget, service: createAiGatewayService({ adapter, authorizer, budget, clock: () => now, id, useCases: [useCase] }), setNow: (value: Date) => { now = value; } };
}

describe("AI gateway fake", () => {
  it("rejects unregistered and runtime-invalid use cases", async () => {
    const { service } = setup();
    await expect(service.invoke({ ...metadata(), useCaseId: "platform.unregistered" })).rejects.toMatchObject({ code: "ai_use_case_unavailable" });
    expect(() => createAiGatewayService({ adapter: createFakeModelAdapter({}), authorizer: { authorize: () => Promise.resolve({ allowed: true, decisionId: crypto.randomUUID() }) }, budget: { reserve: () => Promise.resolve({ allowed: true, reservationId: "fixture" }) }, useCases: [{ ...useCase, inputSchema: { ...inputSchema, properties: { token: { type: "string" } } } }] })).toThrow(AiGatewayError);
  });

  it("creates a non-authoritative proposal and stores only safe call metadata", async () => {
    const { service } = setup();
    const response = await service.invoke(metadata());
    expect(response.proposal).toMatchObject({ authoritative: false, requiresHumanConfirmation: true });
    expect(response.call).toMatchObject({ costMicros: 10, dataClassification: "synthetic", status: "proposal_created", tokenUsage: { input: 3, output: 5, total: 8 } });
    expect(response.call).not.toHaveProperty("input");
    expect(response.call).not.toHaveProperty("output");
    expect(response.call).not.toHaveProperty("prompt");
  });

  it("replays an identical operation without a second model charge and conflicts on changed meaning", async () => {
    const { adapter, budget, service } = setup();
    const command = metadata();
    await expect(service.invoke(command)).resolves.toMatchObject({ replayed: false });
    await expect(service.invoke({ actor: command.actor, dataClassification: "synthetic", input: { syntheticText: "fixture" }, operationId: command.operationId, resourceReference: command.resourceReference, traceId, useCaseId: command.useCaseId })).resolves.toMatchObject({ replayed: true });
    await expect(service.invoke({ ...command, input: { syntheticText: "changed" } })).rejects.toMatchObject({ code: "ai_operation_conflict" });
    expect(adapter.calls()).toBe(1);
    expect(budget.reserve).toHaveBeenCalledOnce();
  });

  it("isolates replayed results from caller mutation", async () => {
    const { service } = setup();
    const command = metadata();
    const first = await service.invoke(command);
    (first.proposal.output as { proposal: string }).proposal = "caller mutation";
    const replay = await service.invoke(command);
    expect(replay.proposal.output).toEqual({ proposal: "synthetic proposal" });
  });

  it("shares an in-flight confirmation and ignores trace metadata in its semantic fingerprint", async () => {
    const runtime = setup();
    const invoked = await runtime.service.invoke(metadata());
    const command = { actor, decision: "accepted" as const, operationId: crypto.randomUUID(), proposalId: invoked.proposal.proposalId, resourceReference: invoked.call.resourceReference, traceId, useCaseId: useCase.useCaseId };
    const [first, second] = await Promise.all([runtime.service.confirm(command), runtime.service.confirm({ ...command, traceId: "abcdef1234567890abcdef1234567890" })]);
    expect(second).toEqual(first);
    expect(runtime.authorizer.authorize).toHaveBeenCalledTimes(2);
  });

  it("fails closed on authorization, budget, data policy, malformed output, and excessive usage", async () => {
    await expect(setup({ allowed: false }).service.invoke(metadata())).rejects.toMatchObject({ code: "ai_use_case_unavailable" });
    const budgetDenied = setup();
    budgetDenied.budget.reserve.mockResolvedValueOnce({ allowed: false });
    await expect(budgetDenied.service.invoke(metadata())).rejects.toMatchObject({ code: "ai_budget_exceeded" });
    await expect(setup().service.invoke({ ...metadata(), dataClassification: "personal" as "synthetic" })).rejects.toMatchObject({ code: "ai_data_policy_rejected" });
    await expect(setup().service.invoke({ ...metadata(), input: { token: "forbidden" } as never })).rejects.toMatchObject({ code: "ai_data_policy_rejected" });
    await expect(setup({ steps: [{ kind: "result", result: { ...result, structuredOutput: { unknown: true } } }] }).service.invoke(metadata())).rejects.toMatchObject({ code: "ai_output_invalid" });
    await expect(setup({ steps: [{ kind: "result", result: { ...result, usage: { ...result.usage, outputTokens: 101 } } }] }).service.invoke(metadata())).rejects.toMatchObject({ code: "ai_output_invalid" });
    await expect(setup({ steps: [{ kind: "result", result: { ...result, usage: undefined as never } }] }).service.invoke(metadata())).rejects.toMatchObject({ code: "ai_output_invalid" });
    const malformedAuthorization = setup();
    malformedAuthorization.authorizer.authorize.mockResolvedValueOnce({ allowed: true, decisionId: "not-a-uuid" } as never);
    await expect(malformedAuthorization.service.invoke(metadata())).rejects.toMatchObject({ code: "ai_adapter_unavailable" });
    const malformedBudget = setup();
    malformedBudget.budget.reserve.mockResolvedValueOnce({ allowed: true });
    await expect(malformedBudget.service.invoke(metadata())).rejects.toMatchObject({ code: "ai_adapter_unavailable" });
  });

  it("requires current confirmation authorization and rejects expired proposals", async () => {
    const runtime = setup();
    const invoked = await runtime.service.invoke(metadata());
    const confirmation = { actor, decision: "accepted" as const, operationId: crypto.randomUUID(), proposalId: invoked.proposal.proposalId, resourceReference: invoked.call.resourceReference, traceId, useCaseId: useCase.useCaseId };
    await expect(runtime.service.confirm(confirmation)).resolves.toMatchObject({ authoritative: false, decision: "accepted", domainCommandExecuted: false });
    expect(runtime.authorizer.authorize).toHaveBeenLastCalledWith(expect.objectContaining({ action: "ai:confirm" }));

    const expired = setup();
    const old = await expired.service.invoke(metadata());
    expired.setNow(new Date("2026-07-26T08:02:00.000Z"));
    await expect(expired.service.confirm({ ...confirmation, operationId: crypto.randomUUID(), proposalId: old.proposal.proposalId })).rejects.toMatchObject({ code: "ai_proposal_expired" });
    await expect(runtime.service.confirm({ ...confirmation, actor: { actorId: "system.synthetic", actorType: "system" }, operationId: crypto.randomUUID() })).rejects.toMatchObject({ code: "ai_invalid_input" });
  });

  it("cannot execute an owning-module command without an accepted confirmation", async () => {
    const formalCommand = vi.fn((confirmation?: { readonly decision: string; readonly domainCommandExecuted: false }) => {
      if (confirmation?.decision !== "accepted") throw new Error("confirmed proposal required");
      return "formal-test-result";
    });
    expect(() => formalCommand()).toThrow("confirmed proposal required");
    expect(formalCommand).toHaveBeenCalledOnce();
    const runtime = setup();
    const invoked = await runtime.service.invoke(metadata());
    const confirmation = await runtime.service.confirm({ actor, decision: "accepted", operationId: crypto.randomUUID(), proposalId: invoked.proposal.proposalId, resourceReference: invoked.call.resourceReference, traceId, useCaseId: useCase.useCaseId });
    expect(confirmation.actor).toEqual(actor);
    expect(confirmation.operationId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(confirmation.resourceReference).toBe(invoked.call.resourceReference);
    expect(confirmation.traceId).toBe(traceId);
    expect(formalCommand(confirmation)).toBe("formal-test-result");
    expect(confirmation.domainCommandExecuted).toBe(false);
  });
});
