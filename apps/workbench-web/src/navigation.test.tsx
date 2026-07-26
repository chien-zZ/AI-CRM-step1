import { describe, expect, it } from "vitest";
import { matchNavigation } from "./navigation";

describe("matchNavigation", () => {
  it("matches nested routes using the longest path", () => {
    const result = matchNavigation("/notifications/todo/42");

    expect(result.primary.key).toBe("notifications");
    expect(result.secondary.key).toBe("/notifications/todo");
  });

  it("falls back to the workbench home", () => {
    const result = matchNavigation("/unknown");

    expect(result.primary.key).toBe("workbench");
    expect(result.secondary.key).toBe("/");
  });
});
