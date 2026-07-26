import { describe, expect, it } from "vitest";
import { matchNavigation } from "./navigation";

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
});
