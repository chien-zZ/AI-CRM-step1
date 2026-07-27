import { describe, expect, it } from "vitest";
import { homePath, normalizePortalStatus, normalizePortalView, statusPath } from "./route-state";

describe("external portal route state", () => {
  it("restores only approved views and statuses", () => {
    expect(normalizePortalView("boundary")).toBe("boundary");
    expect(normalizePortalView("internal-admin")).toBe("overview");
    expect(normalizePortalStatus("denied")).toBe("denied");
    expect(normalizePortalStatus("resource-exists")).toBe("unavailable");
  });

  it("generates only local approved page paths", () => {
    expect(homePath("overview")).toBe("/pages/home/index?view=overview");
    expect(statusPath("session-expired")).toBe("/pages/status/index?kind=session-expired");
  });
});
