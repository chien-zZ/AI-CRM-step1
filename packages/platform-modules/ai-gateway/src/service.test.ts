import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it, vi } from "vitest";
import { AiGatewayError, createAiGatewayService, type AiBudgetPort, type AiCallRecordPort, type AiUseCaseRegistration } from "./index.js";
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
  const callRecords = { record: vi.fn<AiCallRecordPort["record"]>(() => Promise.resolve()) };
  const adapter = createFakeModelAdapter({ [useCase.useCaseId]: options.steps ?? [{ kind: "result", result }, { kind: "result", result }, { kind: "result", result }] });
  return { adapter, authorizer, budget, callRecords, service: createAiGatewayService({ adapter, authorizer, budget, callRecords, clock: () => now, id, useCases: [useCase] }), setNow: (value: Date) => { now = value; } };
}

describe("AI gateway fake", () => {
  it("keeps public JSON Schemas aligned with runtime values", async () => {
    const schemaNames = ["ai-use-case-policy", "ai-call-record", "ai-proposal", "ai-proposal-confirmation"] as const;
    const schemas = await Promise.all(schemaNames.map(async (name) => JSON.parse(await readFile(new URL(`../../../../contracts/ai/${name}.v1.schema.json`, import.meta.url), "utf8")) as object));
    const validators = schemas.map((schema) => new Ajv2020({ strict: true }).compile(schema));
    const runtime = setup();
    const invoked = await runtime.service.invoke(metadata());
    const confirmation = await runtime.service.confirm({ actor, decision: "accepted", operationId: crypto.randomUUID(), proposalId: invoked.proposal.proposalId, resourceReference: invoked.call.resourceReference, traceId, useCaseId: useCase.useCaseId });
    for (const [index, value] of [useCase, invoked.call, invoked.proposal, confirmation].entries()) {
      const validate = validators[index];
      expect(validate?.(value), JSON.stringify(validate?.errors)).toBe(true);
    }
  });

  it("rejects unregistered and runtime-invalid use cases", async () => {
    const { service } = setup();
    await expect(service.invoke({ ...metadata(), useCaseId: "platform.unregistered" })).rejects.toMatchObject({ code: "ai_use_case_unavailable" });
    expect(() => createAiGatewayService({ adapter: createFakeModelAdapter({}), authorizer: { authorize: () => Promise.resolve({ allowed: true, decisionId: crypto.randomUUID() }) }, budget: { reserve: () => Promise.resolve({ allowed: true, reservationId: "fixture" }) }, callRecords: { record: () => Promise.resolve() }, useCases: [{ ...useCase, inputSchema: { ...inputSchema, properties: { token: { type: "string" } } } }] })).toThrow(AiGatewayError);
  });

  it("creates a non-authoritative proposal and stores only safe call metadata", async () => {
    const { callRecords, service } = setup();
    const response = await service.invoke(metadata());
    expect(response.proposal).toMatchObject({ authoritative: false, requiresHumanConfirmation: true });
    expect(response.call).toMatchObject({ actorReference: actor.actorId, actorType: actor.actorType, adapterAttempts: 1, costMicros: 10, dataClassification: "synthetic", status: "proposal_created", tokenUsage: { input: 3, output: 5, total: 8 } });
    expect(response.call.authorizationDecisionId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(callRecords.record).toHaveBeenCalledOnce();
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

  it("persists a stable safe failure and never charges or invokes again for the same operation", async () => {
    const runtime = setup({ steps: [{ category: "ai_adapter_unavailable", kind: "error", retryable: true }, { kind: "result", result }] });
    const command = metadata();
    await expect(runtime.service.invoke(command)).rejects.toMatchObject({ code: "ai_adapter_unavailable", retryable: true });
    await expect(runtime.service.invoke({ ...command, traceId: "abcdef1234567890abcdef1234567890" })).rejects.toMatchObject({ code: "ai_adapter_unavailable", retryable: true });
    await expect(runtime.service.invoke({ ...command, input: { syntheticText: "changed" } })).rejects.toMatchObject({ code: "ai_operation_conflict" });
    expect(runtime.adapter.calls()).toBe(1);
    expect(runtime.budget.reserve).toHaveBeenCalledOnce();
    expect(runtime.callRecords.record).toHaveBeenCalledOnce();
    const failure = runtime.callRecords.record.mock.calls[0]?.[0];
    expect(failure).toMatchObject({ actorReference: actor.actorId, actorType: actor.actorType, adapterAttempts: 1, errorCategory: "dependency", errorCode: "ai_adapter_unavailable", retryable: true, status: "failed" });
    expect(failure?.authorizationDecisionId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(failure).not.toHaveProperty("input");
    expect(failure).not.toHaveProperty("output");
    const callSchema = JSON.parse(await readFile(new URL("../../../../contracts/ai/ai-call-record.v1.schema.json", import.meta.url), "utf8")) as object;
    const validate = new Ajv2020({ strict: true }).compile(callSchema);
    expect(validate(failure), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects nested accessors and custom objects without executing getters", async () => {
    let getterReads = 0;
    const topLevel = Object.defineProperty({}, "useCaseId", { enumerable: true, get: () => { getterReads += 1; return useCase.useCaseId; } });
    await expect(setup().service.invoke(topLevel as never)).rejects.toMatchObject({ code: "ai_invalid_input" });
    const inherited = Object.create(Object.defineProperty({}, "useCaseId", { get: () => { getterReads += 1; return useCase.useCaseId; } })) as object;
    await expect(setup().service.invoke(inherited as never)).rejects.toMatchObject({ code: "ai_invalid_input" });
    const nested = Object.defineProperty({}, "syntheticText", { enumerable: true, get: () => { getterReads += 1; return "fixture"; } });
    await expect(setup().service.invoke({ ...metadata(), input: nested as never })).rejects.toMatchObject({ code: "ai_invalid_input" });
    expect(getterReads).toBe(0);
    await expect(setup().service.invoke({ ...metadata(), input: { nested: new (class Fixture { readonly value = "synthetic"; })() } as never })).rejects.toMatchObject({ code: "ai_invalid_input" });

    const schemaGetter = Object.defineProperty({}, "type", { enumerable: true, get: () => { getterReads += 1; return "string"; } });
    expect(() => createAiGatewayService({ adapter: createFakeModelAdapter({}), authorizer: { authorize: () => Promise.resolve({ allowed: true, decisionId: crypto.randomUUID() }) }, budget: { reserve: () => Promise.resolve({ allowed: true, reservationId: "fixture" }) }, callRecords: { record: () => Promise.resolve() }, useCases: [{ ...useCase, inputSchema: { ...inputSchema, properties: { syntheticText: schemaGetter } } }] })).toThrow(AiGatewayError);
    expect(getterReads).toBe(0);

    const badAuthorization = setup();
    badAuthorization.authorizer.authorize.mockResolvedValueOnce(Object.defineProperty({ allowed: true }, "decisionId", { enumerable: true, get: () => { getterReads += 1; return crypto.randomUUID(); } }) as never);
    await expect(badAuthorization.service.invoke(metadata())).rejects.toMatchObject({ code: "ai_adapter_unavailable" });
    const badBudget = setup();
    badBudget.budget.reserve.mockResolvedValueOnce(Object.defineProperty({ allowed: true }, "reservationId", { enumerable: true, get: () => { getterReads += 1; return "fixture"; } }) as never);
    await expect(badBudget.service.invoke(metadata())).rejects.toMatchObject({ code: "ai_adapter_unavailable" });
    const adapterResult = Object.defineProperty({ adapterVersion: "fake.v1", structuredOutput: result.structuredOutput }, "usage", { enumerable: true, get: () => { getterReads += 1; return result.usage; } });
    const badAdapter = createAiGatewayService({ adapter: { invoke: () => Promise.resolve(adapterResult as never) }, authorizer: { authorize: () => Promise.resolve({ allowed: true, decisionId: crypto.randomUUID() }) }, budget: { reserve: () => Promise.resolve({ allowed: true, reservationId: "fixture" }) }, callRecords: { record: () => Promise.resolve() }, useCases: [useCase] });
    await expect(badAdapter.invoke(metadata())).rejects.toMatchObject({ code: "ai_output_invalid" });
    expect(getterReads).toBe(0);
  });

  it("keeps success and failure call-record contract branches mutually exclusive", async () => {
    const callSchema = JSON.parse(await readFile(new URL("../../../../contracts/ai/ai-call-record.v1.schema.json", import.meta.url), "utf8")) as object;
    const validate = new Ajv2020({ strict: true }).compile(callSchema);
    const successful = (await setup().service.invoke(metadata())).call;
    expect(validate({ ...successful, errorCategory: "dependency", errorCode: "ai_adapter_unavailable", retryable: true })).toBe(false);
    const failedRuntime = setup({ steps: [{ category: "ai_adapter_unavailable", kind: "error", retryable: true }] });
    await expect(failedRuntime.service.invoke(metadata())).rejects.toMatchObject({ code: "ai_adapter_unavailable" });
    const failed = failedRuntime.callRecords.record.mock.calls[0]?.[0];
    expect(validate({ ...failed, adapterVersion: "fake.v1", costMicros: 1, outputDigest: "0".repeat(64), proposalId: crypto.randomUUID(), tokenUsage: { input: 1, output: 1, total: 2 } })).toBe(false);
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
    const denied = setup({ allowed: false });
    await expect(denied.service.invoke(metadata())).rejects.toMatchObject({ code: "ai_use_case_unavailable" });
    const deniedRecord = denied.callRecords.record.mock.calls[0]?.[0];
    expect(deniedRecord).toMatchObject({ errorCategory: "authorization", status: "failed" });
    expect(deniedRecord?.authorizationDecisionId).toMatch(/^[0-9a-f-]{36}$/u);
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
