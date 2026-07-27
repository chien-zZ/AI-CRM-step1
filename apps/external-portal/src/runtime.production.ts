import type { ExternalPortalPort } from "./portal-port";

export const externalPortalPort: ExternalPortalPort = {
  bootstrap: () => Promise.resolve({ kind: "contract-pending" }),
};
