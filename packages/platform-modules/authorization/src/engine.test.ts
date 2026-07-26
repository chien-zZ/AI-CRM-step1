import { describe, expect, it } from "vitest";

import { createAuthorizationService } from "./engine.js";
import { AuthorizationDeniedError, AuthorizationUnavailableError } from "./errors.js";
import {
  createSyntheticAuthorizationService,
  InMemoryAuthorizationCache,
  InMemoryAuthorizationPolicyStore,
  SYNTHETIC_AUTHORIZATION_FIXTURE,
  syntheticPolicySnapshot,
} from "./testing.js";
import type {
  AuthorizationDecisionRecord,
  AuthorizationPolicySnapshot,
  AuthorizationSubjectContext,
  PermissionRequest,
} from "./types.js";

const scopedRequest = (partition?: string): PermissionRequest => ({
  ...SYNTHETIC_AUTHORIZATION_FIXTURE.scopedPermission,
  ...(partition === undefined ? {} : { resourceContext: { "synthetic.partition": partition } }),
});

const subject = (selectedAssignmentId?: string): AuthorizationSubjectContext => ({
  activeAssignmentIds: [
    SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha,
    SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentBeta,
  ],
  workforcePersonId: SYNTHETIC_AUTHORIZATION_FIXTURE.workforcePersonId,
  ...(selectedAssignmentId === undefined ? {} : { selectedAssignmentId }),
});

describe("authorization engine", () => {
  it("allows only the selected Assignment scope and supports explicit switching", async () => {
    const { service } = createSyntheticAuthorizationService();
    await expect(service.check(subject(SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha), scopedRequest("alpha")))
      .resolves.toMatchObject({ allowed: true, reason: "allowed" });
    await expect(service.check(subject(SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha), scopedRequest("beta")))
      .resolves.toMatchObject({ allowed: false, reason: "scope_mismatch" });
    await expect(service.check(subject(SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentBeta), scopedRequest("beta")))
      .resolves.toMatchObject({ allowed: true, reason: "allowed" });
  });

  it("does not union concurrent Assignments when no Assignment is selected", async () => {
    const { service } = createSyntheticAuthorizationService();
    await expect(service.check(subject(), scopedRequest("alpha")))
      .resolves.toMatchObject({ allowed: false, reason: "no_applicable_grant" });
    await expect(service.check(subject(), SYNTHETIC_AUTHORIZATION_FIXTURE.unscopedPermission))
      .resolves.toMatchObject({ allowed: true, reason: "allowed" });
  });

  it("denies unknown permissions, missing object context, and inactive selection", async () => {
    const { service } = createSyntheticAuthorizationService();
    await expect(service.check(subject(SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha), {
      action: "read", resource: "synthetic.unknown",
    })).resolves.toMatchObject({ allowed: false, reason: "unknown_permission" });
    await expect(service.check(subject(SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha), scopedRequest()))
      .resolves.toMatchObject({ allowed: false, reason: "resource_context_required" });
    await expect(service.check({
      activeAssignmentIds: [SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha],
      workforcePersonId: SYNTHETIC_AUTHORIZATION_FIXTURE.workforcePersonId,
      selectedAssignmentId: SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentBeta,
    }, scopedRequest("beta"))).resolves.toMatchObject({ allowed: false, reason: "invalid_context" });
  });

  it("resolves a typed scope without query-language material", async () => {
    const { service } = createSyntheticAuthorizationService();
    const result = await service.resolveDataScope(
      subject(SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha),
      SYNTHETIC_AUTHORIZATION_FIXTURE.scopedPermission,
    );
    expect(result).toMatchObject({
      decision: { allowed: true, reason: "allowed" },
      scope: { version: 1, terms: [{
        kind: "match", constraints: [{ dimension: "synthetic.partition", values: ["alpha"] }],
      }] },
    });
    expect(JSON.stringify(result.scope)).not.toMatch(/sql|where|table|column|prisma/iu);
  });

  it("rejects object context passed to scope resolution at runtime", async () => {
    const { service } = createSyntheticAuthorizationService();
    const result = await service.resolveDataScope(
      subject(SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha),
      { ...SYNTHETIC_AUTHORIZATION_FIXTURE.scopedPermission,
        resourceContext: { "synthetic.partition": "alpha" } } as never,
    );
    expect(result).toMatchObject({ decision: { allowed: false, reason: "invalid_context" } });
    expect(result).not.toHaveProperty("scope");
    await expect(service.resolveDataScope(
      subject(SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha),
      { ...SYNTHETIC_AUTHORIZATION_FIXTURE.scopedPermission, resourceContext: undefined } as never,
    )).resolves.toMatchObject({ decision: { allowed: false, reason: "invalid_context" } });
  });

  it("keeps batch checks in input order with single-check semantics", async () => {
    const { records, service } = createSyntheticAuthorizationService();
    const decisions = await service.batchCheck(subject(SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha), [
      scopedRequest("alpha"), scopedRequest("beta"), { action: "read", resource: "synthetic.unknown" },
    ]);
    expect(decisions.map(({ reason }) => reason)).toEqual(["allowed", "scope_mismatch", "unknown_permission"]);
    expect(records.map(({ operation }) => operation)).toEqual(["batch_check", "batch_check", "batch_check"]);
  });

  it("treats grant intervals as half-open boundaries", async () => {
    const original = syntheticPolicySnapshot();
    const firstGrant = original.grants[0];
    if (firstGrant === undefined) throw new Error("synthetic fixture is incomplete");
    const snapshot: AuthorizationPolicySnapshot = {
      ...original,
      grants: [{ ...firstGrant, validTo: "2026-02-01T00:00:00.000Z" }, ...original.grants.slice(1)],
    };
    const store = new InMemoryAuthorizationPolicyStore(snapshot);
    const service = createAuthorizationService(
      { recorder: { record: () => Promise.resolve() }, store },
      { cacheTtlSeconds: 60, clock: () => new Date("2026-02-01T00:00:00.000Z"), traceId: () => "1234567890abcdef1234567890abcdef" },
    );
    await expect(service.check(subject(SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha), scopedRequest("alpha")))
      .resolves.toMatchObject({ allowed: false, reason: "no_applicable_grant" });
  });

  it("uses cache hits only when they equal a fresh policy evaluation", async () => {
    const cache = new InMemoryAuthorizationCache();
    const events: object[] = [];
    const store = new InMemoryAuthorizationPolicyStore();
    const service = createAuthorizationService({
      cache,
      observer: { record: (event) => events.push(event) },
      recorder: { record: () => Promise.resolve() },
      store,
    }, { cacheTtlSeconds: 60, clock: () => new Date("2026-02-01T00:00:00.000Z"), traceId: () => "1234567890abcdef1234567890abcdef" });
    const input = subject(SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha);
    await service.check(input, scopedRequest("alpha"));
    await service.check(input, scopedRequest("alpha"));
    expect(events).toEqual([
      expect.objectContaining({ cache: "miss", status: "allowed" }),
      expect.objectContaining({ cache: "hit", status: "allowed" }),
    ]);
  });

  it("recomputes on cache failure or corrupt cached authorization", async () => {
    const { cache, service } = createSyntheticAuthorizationService();
    cache.fail = true;
    await expect(service.check(
      subject(SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha), scopedRequest("beta"),
    )).resolves.toMatchObject({ allowed: false, reason: "scope_mismatch" });
    cache.fail = false;
    await service.check(subject(SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha), scopedRequest("beta"));
    const key = [...cache.values.keys()][0];
    if (key === undefined) throw new Error("synthetic cache entry is missing");
    cache.values.set(key, { allowed: true, policyVersion: "synthetic-v1", reason: "allowed" });
    await expect(service.check(
      subject(SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha), scopedRequest("beta"),
    )).resolves.toMatchObject({ allowed: false, reason: "scope_mismatch" });
  });

  it("isolates cache by policy version and supports explicit cleanup", async () => {
    const { cache, service, store } = createSyntheticAuthorizationService();
    const input = subject(SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha);
    await service.check(input, scopedRequest("alpha"));
    store.publish({ ...syntheticPolicySnapshot(), grants: [], version: "synthetic-v2" });
    await expect(service.check(input, scopedRequest("alpha")))
      .resolves.toMatchObject({ allowed: false, policyVersion: "synthetic-v2", reason: "no_applicable_grant" });
    await service.invalidatePolicyVersion("synthetic-v1");
    expect(cache.invalidated).toEqual(["synthetic-v1"]);
  });

  it("fails closed for unavailable or invalid policy snapshots", async () => {
    const records: AuthorizationDecisionRecord[] = [];
    const unavailable = createAuthorizationService({
      recorder: { record: (record) => { records.push(record); return Promise.resolve(); } },
      store: {
        currentVersion: () => Promise.reject(new Error("synthetic unavailable")),
        load: () => Promise.resolve(undefined),
      },
    }, { cacheTtlSeconds: 60, traceId: () => "1234567890abcdef1234567890abcdef" });
    await expect(unavailable.check(subject(), SYNTHETIC_AUTHORIZATION_FIXTURE.unscopedPermission))
      .resolves.toMatchObject({ allowed: false, reason: "policy_unavailable" });

    const invalid = createAuthorizationService({
      recorder: { record: () => Promise.resolve() },
      store: { currentVersion: () => Promise.resolve("broken-v1"), load: () => Promise.resolve({ version: "broken-v1" }) },
    }, { cacheTtlSeconds: 60, traceId: () => "1234567890abcdef1234567890abcdef" });
    await expect(invalid.check(subject(), SYNTHETIC_AUTHORIZATION_FIXTURE.unscopedPermission))
      .resolves.toMatchObject({ allowed: false, reason: "policy_invalid" });
  });

  it("does not return a decision when mandatory recording fails", async () => {
    const service = createAuthorizationService({
      recorder: { record: () => Promise.reject(new Error("synthetic recorder failure")) },
      store: new InMemoryAuthorizationPolicyStore(),
    }, { cacheTtlSeconds: 60, clock: () => new Date("2026-02-01T00:00:00.000Z"), traceId: () => "1234567890abcdef1234567890abcdef" });
    await expect(service.check(subject(), SYNTHETIC_AUTHORIZATION_FIXTURE.unscopedPermission))
      .rejects.toBeInstanceOf(AuthorizationUnavailableError);
  });

  it("does not return or record a decision with a malformed generated id", async () => {
    const records: AuthorizationDecisionRecord[] = [];
    const service = createAuthorizationService({
      recorder: { record: (record) => { records.push(record); return Promise.resolve(); } },
      store: new InMemoryAuthorizationPolicyStore(),
    }, {
      cacheTtlSeconds: 60,
      decisionId: () => "not-a-uuid",
      traceId: () => "1234567890abcdef1234567890abcdef",
    });
    await expect(service.check(subject(), SYNTHETIC_AUTHORIZATION_FIXTURE.unscopedPermission))
      .rejects.toBeInstanceOf(AuthorizationUnavailableError);
    expect(records).toEqual([]);
  });

  it("records bounded decision references and exposes a generic server-side denial", async () => {
    const { records, service } = createSyntheticAuthorizationService();
    await expect(service.requireAllowed(
      subject(SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha), scopedRequest("beta"),
    )).rejects.toBeInstanceOf(AuthorizationDeniedError);
    expect(records.at(-1)).toMatchObject({
      selectedAssignmentId: SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha,
      traceId: "1234567890abcdef1234567890abcdef",
      workforcePersonId: SYNTHETIC_AUTHORIZATION_FIXTURE.workforcePersonId,
    });
    expect(JSON.stringify(records)).not.toContain("beta");
  });

  it("normalizes contract-valid uppercase UUIDs before grant evaluation", async () => {
    const { service } = createSyntheticAuthorizationService();
    const uppercaseSubject = {
      activeAssignmentIds: [SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha.toUpperCase()],
      selectedAssignmentId: SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha.toUpperCase(),
      workforcePersonId: SYNTHETIC_AUTHORIZATION_FIXTURE.workforcePersonId.toUpperCase(),
    };
    await expect(service.requireAllowed(uppercaseSubject, scopedRequest("alpha")))
      .resolves.toMatchObject({ allowed: true, reason: "allowed" });
  });

  it("maps clock and identifier provider failures to fail-closed outcomes", async () => {
    const clockFailure = createSyntheticAuthorizationService({ clock: () => { throw new Error("clock failed"); } });
    await expect(clockFailure.service.check(subject(), SYNTHETIC_AUTHORIZATION_FIXTURE.unscopedPermission))
      .resolves.toMatchObject({ allowed: false, reason: "policy_unavailable" });

    const idFailure = createSyntheticAuthorizationService({ decisionId: () => { throw new Error("id failed"); } });
    await expect(idFailure.service.check(subject(), SYNTHETIC_AUTHORIZATION_FIXTURE.unscopedPermission))
      .rejects.toBeInstanceOf(AuthorizationUnavailableError);
  });
});
