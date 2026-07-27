export type PortalStatus = "contract-pending" | "denied" | "empty" | "offline" | "session-expired" | "unavailable";

export type SyntheticPortalEntry = Readonly<{
  id: string;
  summary: string;
  title: string;
}>;

export type ReadyPortalBootstrap = Readonly<{
  entries: readonly SyntheticPortalEntry[];
  fixture: true;
  kind: "ready";
}>;

export type PortalBootstrapResult = ReadyPortalBootstrap | Readonly<{ kind: PortalStatus }>;

export interface ExternalPortalPort {
  bootstrap(): Promise<PortalBootstrapResult>;
}
