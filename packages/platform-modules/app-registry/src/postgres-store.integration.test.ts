import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseRuntime, runMigrations, type DatabaseRuntime } from "@ai-crm/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPostgresApplicationRegistryCapabilityProbe, createPostgresApplicationRegistryQueryService } from "./index.js";
import { createPostgresApplicationRegistryStore } from "./postgres-store.js";
import { createApplicationRegistryService } from "./service.js";

const urlFile = process.env.TEST_APP_REGISTRY_DATABASE_URL_FILE;
const suite = describe.skipIf(!urlFile);
suite("PostgreSQL application registry", () => {
  let connectionString = "";
  let runtime: DatabaseRuntime | undefined;
  beforeAll(async () => {
    if (!urlFile) throw new Error("TEST_APP_REGISTRY_DATABASE_URL_FILE is required.");
    connectionString = (await readFile(resolve(urlFile), "utf8")).toString().trim();
    await runMigrations(connectionString, resolve(import.meta.dirname, "../../../database/migrations"));
    await runMigrations(connectionString, resolve(import.meta.dirname, "../migrations"));
    runtime = createDatabaseRuntime({ applicationName: "plt_01_registry_test", connectionString, connectionTimeoutMs: 5_000, idleTimeoutMs: 5_000, maxConnections: 4, statementTimeoutMs: 5_000 });
  });
  afterAll(async () => runtime?.close());

  it("persists registrations and blocks a disabled deep link", async () => {
    if (!runtime) throw new Error("Application Registry runtime is unavailable.");
    const authorization = { authorize: vi.fn(() => Promise.resolve({ allowed: true, decisionId: randomUUID() })) };
    const audit = { record: vi.fn(() => Promise.resolve()) };
    const service = createApplicationRegistryService(createPostgresApplicationRegistryStore(runtime), authorization, audit);
    const actor = { actorId: "system.synthetic", actorType: "system" as const };
    const meta = () => ({ actor, operationId: randomUUID(), reason: "synthetic test", traceId: "1234567890abcdef1234567890abcdef" });
    const application = { applicationId: "platform.integration", audience: "internal" as const, enabled: true, permissionCode: "platform.integration:view" };
    const route = { applicationId: application.applicationId, deepLinkSources: ["task"] as const, enabled: true, path: "/platform/integration/:resource_reference", permissionCode: "platform.integration:open", routeId: "platform.integration.detail" };
    await service.mutate({ ...meta(), application, kind: "register_application" });
    await service.mutate({ ...meta(), kind: "register_route", route });
    const link = { applicationId: application.applicationId, resourceReference: "synthetic:1", routeId: route.routeId, source: "task" as const, version: 1 as const };
    await expect(service.resolveDeepLink({ actor, audience: "internal", link })).resolves.toMatchObject({ routeId: route.routeId });
    await service.mutate({ ...meta(), enabled: false, kind: "set_application_enabled", applicationId: application.applicationId });
    await expect(service.resolveDeepLink({ actor, audience: "internal", link })).rejects.toMatchObject({ code: "app_registry_target_unavailable" });
  });

  it("keeps external queries from returning internal registrations", async () => {
    if (!runtime) throw new Error("Application Registry runtime is unavailable.");
    const rows = await createPostgresApplicationRegistryStore(runtime).listApplications("external");
    expect(rows).toEqual([]);
  });

  it("serializes concurrent duplicate mutations", async () => {
    if (!runtime) throw new Error("Application Registry runtime is unavailable.");
    const store = createPostgresApplicationRegistryStore(runtime);
    const mutation = { actor: { actorId: "system.synthetic", actorType: "system" as const }, application: { applicationId: "platform.concurrent", audience: "internal" as const, enabled: true, permissionCode: "platform.concurrent:view" }, kind: "register_application" as const, operationId: randomUUID(), reason: "synthetic concurrency", traceId: "1234567890abcdef1234567890abcdef" };
    const { mutationFingerprint } = await import("./validation.js");
    await expect(Promise.all([store.commit({ fingerprint: mutationFingerprint(mutation), mutation }), store.commit({ fingerprint: mutationFingerprint(mutation), mutation })])).resolves.toEqual([{ replayed: false }, { replayed: true }]);
  });

  it("enforces the navigation self-parent invariant in PostgreSQL", async () => {
    if (!runtime) throw new Error("Application Registry runtime is unavailable.");
    const suffix = randomUUID().slice(0, 8);
    const applicationId = `platform.self.${suffix}`;
    const routeId = `platform.self.route.${suffix}`;
    const navigationId = `platform.self.nav.${suffix}`;
    await runtime.execute("insert into app_registry.applications (application_id,audience,enabled,permission_code) values ($1,'internal',true,$2)", [applicationId, "platform.self:view"]);
    await runtime.execute("insert into app_registry.routes (route_id,application_id,path,enabled,permission_code,deep_link_sources) values ($1,$2,'/platform/self',true,$3,array['task']::text[])", [routeId, applicationId, "platform.self:open"]);
    await expect(runtime.execute("insert into app_registry.navigation (navigation_id,application_id,route_id,parent_navigation_id,enabled,display_order) values ($1,$2,$3,$1,true,1)", [navigationId, applicationId, routeId])).rejects.toMatchObject({ code: "23514" });
  });

  it("keeps the probe aligned with real queries under least-privilege column grants", async () => {
    if (!runtime) throw new Error("Application Registry runtime is unavailable.");
    const suffix = randomUUID().replaceAll("-", "");
    const applicationId = `platform.probe.${suffix}`;
    const routeId = `platform.probe.route.${suffix}`;
    await runtime.execute("insert into app_registry.applications (application_id,audience,enabled,permission_code) values ($1,'internal',true,$2)", [applicationId, "platform.probe:read"]);
    await runtime.execute("insert into app_registry.routes (route_id,application_id,path,enabled,permission_code,deep_link_sources) values ($1,$2,'/platform/probe',true,$3,array['task']::text[])", [routeId, applicationId, "platform.probe.route:read"]);
    await runtime.execute("alter table app_registry.applications add column capability_probe_extra text");
    const role = `registry_probe_${randomUUID().replaceAll("-", "")}`;
    await runtime.execute(`create role "${role}" nologin`);
    await runtime.execute(`grant usage on schema app_registry to "${role}"`);
    await runtime.execute(`grant select (application_id,audience,enabled,permission_code) on app_registry.applications to "${role}"`);
    await runtime.execute(`grant select (route_id,application_id,path,enabled,permission_code,deep_link_sources) on app_registry.routes to "${role}"`);
    await runtime.execute(`grant select (navigation_id,application_id,route_id,parent_navigation_id,enabled,display_order) on app_registry.navigation to "${role}"`);
    const restricted = createDatabaseRuntime({ applicationName: "cmp_registry_probe_test", connectionString, connectionTimeoutMs: 5_000, idleTimeoutMs: 5_000, maxConnections: 1, statementTimeoutMs: 5_000 });
    try {
      await restricted.execute(`set role "${role}"`);
      const probe = createPostgresApplicationRegistryCapabilityProbe(restricted);
      const query = createPostgresApplicationRegistryQueryService(restricted, {
        authorize: () => Promise.resolve({ allowed: true, decisionId: randomUUID() }),
      });
      const workforcePersonId = randomUUID();
      const selectedAssignmentId = randomUUID();
      const context = {
        actor: { actorId: "subject:synthetic", actorType: "authenticated_subject" as const, assignmentId: selectedAssignmentId, workforcePersonId },
        subject: { activeAssignmentIds: [selectedAssignmentId], selectedAssignmentId, workforcePersonId },
        traceId: "1234567890abcdef1234567890abcdef",
      };
      await expect(probe.check()).resolves.toEqual({ status: "available" });
      const snapshot = await query.loadRegistry({ audience: "internal", context });
      expect(snapshot.applications.some((application) => application.applicationId === applicationId)).toBe(true);
      await runtime.execute(`revoke select (path) on app_registry.routes from "${role}"`);
      await expect(probe.check()).resolves.toEqual({ status: "unavailable" });
      await expect(query.loadRegistry({ audience: "internal", context })).rejects.toBeDefined();
    } finally {
      await restricted.close();
      await runtime.execute(`revoke select (application_id,audience,enabled,permission_code) on app_registry.applications from "${role}"`);
      await runtime.execute(`revoke select (route_id,application_id,path,enabled,permission_code,deep_link_sources) on app_registry.routes from "${role}"`);
      await runtime.execute(`revoke select (navigation_id,application_id,route_id,parent_navigation_id,enabled,display_order) on app_registry.navigation from "${role}"`);
      await runtime.execute(`revoke usage on schema app_registry from "${role}"`);
      await runtime.execute(`drop role "${role}"`);
    }
  });
});
