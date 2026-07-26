import type { WorkbenchPort } from "./workbench-port";

const unavailableProductionPort: WorkbenchPort = {
  bootstrap: () => Promise.resolve({ kind: "maintenance" }),
  logout: () => Promise.resolve({ kind: "session-expired" }),
};

const lazyDevelopmentPort: WorkbenchPort = {
  bootstrap: async () => {
    const { developmentFixturePort } = await import("./development-fixture");
    return developmentFixturePort.bootstrap();
  },
  logout: async () => {
    const { developmentFixturePort } = await import("./development-fixture");
    return developmentFixturePort.logout();
  },
};

// A generated-client adapter replaces this fail-closed port after the relevant contracts pass G2.
export const runtimeWorkbenchPort = import.meta.env.DEV ? lazyDevelopmentPort : unavailableProductionPort;
