import type { InternalMobilePort } from "./workbench-port";

export const runtimeInternalMobilePort: InternalMobilePort = {
  bootstrap: () => Promise.resolve({ kind: "maintenance" }),
  logout: () => Promise.resolve({ kind: "session-expired" }),
};
