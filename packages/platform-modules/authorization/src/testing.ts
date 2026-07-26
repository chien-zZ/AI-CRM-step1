import { createAuthorizationService } from "./engine.js";
import type {
  AuthorizationCache,
  AuthorizationDecisionRecord,
  AuthorizationPolicySnapshot,
  AuthorizationPolicyStore,
  AuthorizationService,
  AuthorizationServiceOptions,
  CachedAuthorizationEvaluation,
} from "./types.js";

export const SYNTHETIC_AUTHORIZATION_FIXTURE = Object.freeze({
  assignmentAlpha: "50000000-0000-4000-8000-000000000001",
  assignmentBeta: "50000000-0000-4000-8000-000000000002",
  workforcePersonId: "50000000-0000-4000-8000-000000000003",
  policyVersion: "synthetic-v1",
  scopedPermission: Object.freeze({ action: "read", resource: "synthetic.record" }),
  unscopedPermission: Object.freeze({ action: "execute", resource: "synthetic.operation" }),
});

export const syntheticPolicySnapshot = (): AuthorizationPolicySnapshot => ({
  version: SYNTHETIC_AUTHORIZATION_FIXTURE.policyVersion,
  permissions: [
    {
      action: "read", code: "synthetic.record:read", resource: "synthetic.record",
      scopeDimensions: ["synthetic.partition"],
    },
    {
      action: "execute", code: "synthetic.operation:execute", resource: "synthetic.operation",
      scopeDimensions: [],
    },
  ],
  roles: [
    {
      roleId: "51000000-0000-4000-8000-000000000001",
      permissions: [{
        permissionCode: "synthetic.record:read",
        scope: { version: 1, terms: [{
          kind: "match", constraints: [{ dimension: "synthetic.partition", values: ["alpha"] }],
        }] },
      }],
    },
    {
      roleId: "51000000-0000-4000-8000-000000000002",
      permissions: [{
        permissionCode: "synthetic.record:read",
        scope: { version: 1, terms: [{
          kind: "match", constraints: [{ dimension: "synthetic.partition", values: ["beta"] }],
        }] },
      }],
    },
    {
      roleId: "51000000-0000-4000-8000-000000000003",
      permissions: [{
        permissionCode: "synthetic.operation:execute",
        scope: { version: 1, terms: [{ kind: "all" }] },
      }],
    },
  ],
  grants: [
    {
      grantId: "52000000-0000-4000-8000-000000000001",
      roleId: "51000000-0000-4000-8000-000000000001",
      subject: { assignmentId: SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentAlpha, kind: "assignment" },
      validFrom: "2026-01-01T00:00:00.000Z",
    },
    {
      grantId: "52000000-0000-4000-8000-000000000002",
      roleId: "51000000-0000-4000-8000-000000000002",
      subject: { assignmentId: SYNTHETIC_AUTHORIZATION_FIXTURE.assignmentBeta, kind: "assignment" },
      validFrom: "2026-01-01T00:00:00.000Z",
    },
    {
      grantId: "52000000-0000-4000-8000-000000000003",
      roleId: "51000000-0000-4000-8000-000000000003",
      subject: { kind: "workforce_person", workforcePersonId: SYNTHETIC_AUTHORIZATION_FIXTURE.workforcePersonId },
      validFrom: "2026-01-01T00:00:00.000Z",
    },
  ],
});

export class InMemoryAuthorizationPolicyStore implements AuthorizationPolicyStore {
  readonly #snapshots = new Map<string, unknown>();
  #version: string;

  public constructor(snapshot: AuthorizationPolicySnapshot = syntheticPolicySnapshot()) {
    this.#version = snapshot.version;
    this.#snapshots.set(snapshot.version, snapshot);
  }

  public currentVersion(): Promise<string> { return Promise.resolve(this.#version); }
  public load(version: string): Promise<unknown> { return Promise.resolve(this.#snapshots.get(version)); }
  public publish(snapshot: AuthorizationPolicySnapshot): void {
    this.#snapshots.set(snapshot.version, snapshot);
    this.#version = snapshot.version;
  }
}

export class InMemoryAuthorizationCache implements AuthorizationCache {
  public fail = false;
  public readonly invalidated: string[] = [];
  public readonly values = new Map<string, CachedAuthorizationEvaluation>();

  public get(key: string): Promise<CachedAuthorizationEvaluation | undefined> {
    return this.fail ? Promise.reject(new Error("synthetic cache failure")) : Promise.resolve(this.values.get(key));
  }
  public invalidatePolicyVersion(version: string): Promise<void> {
    if (this.fail) return Promise.reject(new Error("synthetic cache failure"));
    this.invalidated.push(version);
    this.values.clear();
    return Promise.resolve();
  }
  public set(
    key: string,
    value: CachedAuthorizationEvaluation,
    _ttlSeconds: number,
    _policyVersion: string,
  ): Promise<void> {
    if (this.fail) return Promise.reject(new Error("synthetic cache failure"));
    void _ttlSeconds;
    void _policyVersion;
    this.values.set(key, value);
    return Promise.resolve();
  }
}

export const createSyntheticAuthorizationService = (
  options: Partial<AuthorizationServiceOptions> = {},
): {
  readonly cache: InMemoryAuthorizationCache;
  readonly records: AuthorizationDecisionRecord[];
  readonly service: AuthorizationService;
  readonly store: InMemoryAuthorizationPolicyStore;
} => {
  const cache = new InMemoryAuthorizationCache();
  const records: AuthorizationDecisionRecord[] = [];
  const store = new InMemoryAuthorizationPolicyStore();
  let sequence = 1;
  const service = createAuthorizationService(
    { cache, recorder: { record: (record) => { records.push(record); return Promise.resolve(); } }, store },
    {
      cacheTtlSeconds: options.cacheTtlSeconds ?? 60,
      clock: options.clock ?? (() => new Date("2026-02-01T00:00:00.000Z")),
      decisionId: options.decisionId ?? (() => `53000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`),
      traceId: options.traceId ?? (() => "1234567890abcdef1234567890abcdef"),
    },
  );
  return { cache, records, service, store };
};
