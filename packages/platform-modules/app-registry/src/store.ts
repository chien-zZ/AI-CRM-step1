import type { RegisteredApplication, RegisteredNavigation, RegisteredRoute, RegistryAudience, RegistryMutationCommand } from "./types.js";

export interface RegistryCommit {
  readonly fingerprint: string;
  readonly mutation: RegistryMutationCommand;
}

export interface ApplicationRegistryStore {
  commit(command: RegistryCommit): Promise<{ readonly replayed: boolean }>;
  findApplication(applicationId: string): Promise<RegisteredApplication | undefined>;
  findRoute(routeId: string): Promise<RegisteredRoute | undefined>;
  listApplications(audience: RegistryAudience): Promise<readonly RegisteredApplication[]>;
  listNavigation(applicationIds: readonly string[]): Promise<readonly RegisteredNavigation[]>;
  listRoutes(applicationIds: readonly string[]): Promise<readonly RegisteredRoute[]>;
}

export interface AppRegistryPersistenceRuntime {
  execute<Row = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<AppRegistryPersistenceResult<Row>>;
  withTransaction<T>(work: () => Promise<T>): Promise<T>;
}
export interface AppRegistryPersistenceResult<Row> { readonly rowCount: number; readonly rows: readonly Row[] }
