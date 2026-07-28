import { describe, expect, it, vi } from "vitest";
import { createPostgresApplicationRegistryQueryService, type AppRegistryPersistenceRuntime, type RegistryQueryContext } from "./index.js";

const person = "10000000-0000-4000-8000-000000000001";
const assignment = "20000000-0000-4000-8000-000000000001";
const context = (): RegistryQueryContext => ({ actor: { actorId: "subject:synthetic", actorType: "authenticated_subject", assignmentId: assignment, workforcePersonId: person }, subject: { activeAssignmentIds: [assignment], selectedAssignmentId: assignment, workforcePersonId: person }, traceId: "1234567890abcdef1234567890abcdef" });
function runtime(): AppRegistryPersistenceRuntime {
  const execute: AppRegistryPersistenceRuntime["execute"] = vi.fn((sql: string) => {
    let rows: readonly unknown[] = [];
    if (sql.includes("from app_registry.applications")) rows = [{ application_id: "platform.synthetic", audience: "internal", enabled: true, permission_code: "platform.synthetic:read" }];
    if (sql.includes("from app_registry.routes")) rows = [{ application_id: "platform.synthetic", deep_link_sources: ["task"], enabled: true, path: "/synthetic/:id", permission_code: "platform.synthetic.route:read", route_id: "platform.synthetic.route" }];
    if (sql.includes("from app_registry.navigation")) rows = [{ application_id: "platform.synthetic", display_order: 1, enabled: true, navigation_id: "platform.synthetic.nav", parent_navigation_id: null, route_id: "platform.synthetic.route" }];
    return Promise.resolve({ rowCount: rows.length, rows } as never);
  });
  return { execute, withTransaction: (work) => work() };
}

describe("createPostgresApplicationRegistryQueryService", () => {
  it("passes dynamic permissions and the explicit request subject to authorization", async () => {
    const authorize = vi.fn(() => Promise.resolve({ allowed: true, decisionId: "30000000-0000-4000-8000-000000000001" }));
    const service = createPostgresApplicationRegistryQueryService(runtime(), { authorize });
    await expect(service.loadRegistry({ audience: "internal", context: context() })).resolves.toMatchObject({ applications: [{ applicationId: "platform.synthetic" }], routes: [{ routeId: "platform.synthetic.route" }], version: 1 });
    expect(authorize).toHaveBeenNthCalledWith(1, expect.objectContaining({ permission: { action: "read", code: "platform.synthetic:read", resource: "platform.synthetic" }, subject: { activeAssignmentIds: [assignment], selectedAssignmentId: assignment, workforcePersonId: person }, traceId: context().traceId }));
    expect(authorize).toHaveBeenNthCalledWith(2, expect.objectContaining({ permission: { action: "read", code: "platform.synthetic.route:read", resource: "platform.synthetic.route" } }));
  });

  it("rejects contradictory selected-assignment context before authorization or SQL", async () => {
    const db = runtime();
    const authorize = vi.fn(() => Promise.resolve({ allowed: true, decisionId: "30000000-0000-4000-8000-000000000001" }));
    const service = createPostgresApplicationRegistryQueryService(db, { authorize });
    const invalid = context();
    await expect(service.loadRegistry({ audience: "internal", context: { ...invalid, actor: { actorId: invalid.actor.actorId, actorType: invalid.actor.actorType, workforcePersonId: person } } })).rejects.toMatchObject({ code: "app_registry_invalid_input" });
    expect(authorize).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("fails authorization dependency errors closed", async () => {
    const service = createPostgresApplicationRegistryQueryService(runtime(), { authorize: () => Promise.reject(new Error("private policy detail")) });
    await expect(service.loadRegistry({ audience: "internal", context: context() })).rejects.toMatchObject({ code: "app_registry_unavailable", retryable: true });
  });
});
