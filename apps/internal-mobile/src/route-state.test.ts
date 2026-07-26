import { describe, expect, it } from "vitest";
import { normalizeRouteState, normalizeSection, normalizeStatus, sectionPath } from "./route-state";

describe("mobile route state", () => {
  const ids = ["item-1", "item-2", "item-3", "item-4"];

  it("restores a valid page and stable selection", () => {
    expect(normalizeRouteState({ page: "2", selected: "item-4" }, ids)).toEqual({ page: 2, selected: "item-4" });
    expect(sectionPath("tasks", { page: 2, selected: "item-4" })).toBe("/pages/tasks/index?page=2&selected=item-4");
  });

  it("canonicalizes malformed, overflowing, and unknown values", () => {
    expect(normalizeRouteState({ page: "not-a-number", selected: "missing" }, ids)).toEqual({ page: 1 });
    expect(normalizeRouteState({ page: "99" }, ids)).toEqual({ page: 2 });
    expect(normalizeRouteState({ page: "-3" }, ids)).toEqual({ page: 1 });
    expect(normalizeSection("unknown")).toBe("home");
    expect(normalizeStatus("unknown")).toBe("unavailable");
  });

  it("keeps the home URL free of collection state", () => {
    expect(sectionPath("home", { page: 9, selected: "ignored" })).toBe("/pages/home/index");
  });
});
