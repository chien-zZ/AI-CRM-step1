import { AppRegistryError } from "./errors.js";
import type { ApplicationRegistryStore, AppRegistryPersistenceRuntime, RegistryCommit } from "./store.js";
import type { RegisteredApplication, RegisteredNavigation, RegisteredRoute, RegistryAudience } from "./types.js";

class PostgresApplicationRegistryStore implements ApplicationRegistryStore {
  constructor(private readonly runtime: AppRegistryPersistenceRuntime) {}
  async commit({ fingerprint, mutation }: RegistryCommit): Promise<{ readonly replayed: boolean }> {
    return this.runtime.withTransaction(async () => {
      await this.runtime.execute("select pg_advisory_xact_lock(hashtextextended($1::text, 0))", [mutation.operationId]);
      const prior = await this.runtime.execute<{ fingerprint: string }>("select fingerprint from app_registry.operation_receipts where operation_id = $1 for update", [mutation.operationId]);
      if (prior.rows[0] !== undefined) {
        if (prior.rows[0].fingerprint !== fingerprint) throw new AppRegistryError("app_registry_operation_conflict");
        return { replayed: true };
      }
      try {
        if (mutation.kind === "register_application") await this.runtime.execute("insert into app_registry.applications (application_id,audience,enabled,permission_code) values ($1,$2,$3,$4)", [mutation.application.applicationId, mutation.application.audience, mutation.application.enabled, mutation.application.permissionCode]);
        if (mutation.kind === "register_route") await this.runtime.execute("insert into app_registry.routes (route_id,application_id,path,enabled,permission_code,deep_link_sources) values ($1,$2,$3,$4,$5,$6)", [mutation.route.routeId, mutation.route.applicationId, mutation.route.path, mutation.route.enabled, mutation.route.permissionCode, mutation.route.deepLinkSources]);
        if (mutation.kind === "register_navigation") await this.runtime.execute("insert into app_registry.navigation (navigation_id,application_id,route_id,parent_navigation_id,enabled,display_order) values ($1,$2,$3,$4,$5,$6)", [mutation.navigation.navigationId, mutation.navigation.applicationId, mutation.navigation.routeId, mutation.navigation.parentNavigationId ?? null, mutation.navigation.enabled, mutation.navigation.order]);
        if (mutation.kind === "set_application_enabled") {
          const result = await this.runtime.execute("update app_registry.applications set enabled = $2 where application_id = $1", [mutation.applicationId, mutation.enabled]);
          if (result.rowCount !== 1) throw new AppRegistryError("app_registry_target_unavailable");
        }
        if (mutation.kind === "set_route_enabled") {
          const result = await this.runtime.execute("update app_registry.routes set enabled = $2 where route_id = $1", [mutation.routeId, mutation.enabled]);
          if (result.rowCount !== 1) throw new AppRegistryError("app_registry_target_unavailable");
        }
        await this.runtime.execute("insert into app_registry.operation_receipts (operation_id,fingerprint) values ($1,$2)", [mutation.operationId, fingerprint]);
      } catch (error) {
        if ((error as { readonly code?: string }).code === "23505" || (error as { readonly code?: string }).code === "23503") throw new AppRegistryError("app_registry_operation_conflict");
        throw error;
      }
      return { replayed: false };
    });
  }
  async findApplication(id: string): Promise<RegisteredApplication | undefined> {
    const result = await this.runtime.execute<ApplicationRow>("select application_id,audience,enabled,permission_code from app_registry.applications where application_id = $1", [id]);
    return result.rows[0] === undefined ? undefined : application(result.rows[0]);
  }
  async findRoute(id: string): Promise<RegisteredRoute | undefined> {
    const result = await this.runtime.execute<RouteRow>("select route_id,application_id,path,enabled,permission_code,deep_link_sources from app_registry.routes where route_id = $1", [id]);
    return result.rows[0] === undefined ? undefined : route(result.rows[0]);
  }
  async listApplications(audience: RegistryAudience): Promise<readonly RegisteredApplication[]> {
    const result = await this.runtime.execute<ApplicationRow>("select application_id,audience,enabled,permission_code from app_registry.applications where audience = $1 order by application_id", [audience]);
    return result.rows.map(application);
  }
  async listNavigation(ids: readonly string[]): Promise<readonly RegisteredNavigation[]> {
    if (ids.length === 0) return [];
    const result = await this.runtime.execute<NavigationRow>("select navigation_id,application_id,route_id,parent_navigation_id,enabled,display_order from app_registry.navigation where application_id = any($1::text[]) order by display_order,navigation_id", [ids]);
    return result.rows.map(navigation);
  }
  async listRoutes(ids: readonly string[]): Promise<readonly RegisteredRoute[]> {
    if (ids.length === 0) return [];
    const result = await this.runtime.execute<RouteRow>("select route_id,application_id,path,enabled,permission_code,deep_link_sources from app_registry.routes where application_id = any($1::text[]) order by route_id", [ids]);
    return result.rows.map(route);
  }
}

interface ApplicationRow { readonly application_id: string; readonly audience: RegistryAudience; readonly enabled: boolean; readonly permission_code: string }
interface RouteRow { readonly application_id: string; readonly deep_link_sources: DeepLinkSourceRow; readonly enabled: boolean; readonly path: string; readonly permission_code: string; readonly route_id: string }
type DeepLinkSourceRow = readonly ("notification" | "task")[];
interface NavigationRow { readonly application_id: string; readonly display_order: number; readonly enabled: boolean; readonly navigation_id: string; readonly parent_navigation_id: string | null; readonly route_id: string }
const application = (row: ApplicationRow): RegisteredApplication => ({ applicationId: row.application_id, audience: row.audience, enabled: row.enabled, permissionCode: row.permission_code });
const route = (row: RouteRow): RegisteredRoute => ({ applicationId: row.application_id, deepLinkSources: row.deep_link_sources, enabled: row.enabled, path: row.path, permissionCode: row.permission_code, routeId: row.route_id });
const navigation = (row: NavigationRow): RegisteredNavigation => ({ applicationId: row.application_id, enabled: row.enabled, navigationId: row.navigation_id, order: row.display_order, ...(row.parent_navigation_id === null ? {} : { parentNavigationId: row.parent_navigation_id }), routeId: row.route_id });
export const createPostgresApplicationRegistryStore = (runtime: AppRegistryPersistenceRuntime): ApplicationRegistryStore => new PostgresApplicationRegistryStore(runtime);
