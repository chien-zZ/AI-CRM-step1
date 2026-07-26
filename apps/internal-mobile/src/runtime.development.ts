import type { InternalMobilePort } from "./workbench-port";

export const runtimeInternalMobilePort: InternalMobilePort = {
  bootstrap: async () => (await import("./development-fixture")).developmentFixturePort.bootstrap(),
  logout: async () => (await import("./development-fixture")).developmentFixturePort.logout(),
};
