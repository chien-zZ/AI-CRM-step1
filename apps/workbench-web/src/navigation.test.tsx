import { describe, expect, it } from "vitest";
import { getNavigationSelection, matchNavigation } from "./navigation";

describe("matchNavigation", () => {
  it("matches a nested location using the longest registered prefix", () => {
    expect(matchNavigation("/notifications/fixture-notification-01")?.key).toBe("/notifications");
  });

  it("does not claim an unknown route as the workbench home", () => {
    expect(matchNavigation("/not-registered")).toBeUndefined();
  });

  it("does not match a partial path segment", () => {
    expect(matchNavigation("/tasks-extra")).toBeUndefined();
  });

  it("returns the selected leaf and its two-level navigation parent", () => {
    expect(getNavigationSelection("/tasks/synthetic-reference")).toEqual({
      openKeys: ["/coordination"],
      selectedKey: "/tasks",
    });
  });
});
