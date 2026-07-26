export interface PlatformItem {
  id: string;
  title: string;
  status: string;
  summary: string;
  tab: "active" | "history";
}

export interface PlatformCollection {
  title: string;
  fixture: boolean;
  statuses: string[];
  items: PlatformItem[];
}

export type BootstrapResult =
  | { kind: "signed-out" }
  | { kind: "session-expired" }
  | { kind: "maintenance" }
  | {
      kind: "ready";
      fixture: boolean;
      context: { displayName: string; assignmentReference: string };
      counts: { tasks: number; notifications: number; forms: number; files: number };
      collections: Record<"tasks" | "notifications" | "forms" | "files", PlatformCollection>;
    };

export interface WorkbenchPort {
  bootstrap(): Promise<BootstrapResult>;
  logout(): Promise<{ kind: "session-expired" | "signed-out" }>;
}
