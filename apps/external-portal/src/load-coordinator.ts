import type { PortalBootstrapResult } from "./portal-port";

export function createLoadCoordinator(load: () => Promise<PortalBootstrapResult>) {
  let generation = 0;
  let pending: Promise<PortalBootstrapResult> | undefined;
  return {
    invalidate(): void { generation += 1; pending = undefined; },
    load(): Promise<PortalBootstrapResult> {
      if (pending !== undefined) return pending;
      const startedAt = generation;
      const created = load().then<PortalBootstrapResult, PortalBootstrapResult>(
        (result) => startedAt === generation ? result : { kind: "unavailable" as const },
        () => ({ kind: "unavailable" as const }),
      ).finally(() => { if (startedAt === generation) pending = undefined; });
      pending = created;
      return created;
    },
  };
}
