import { describe, expect, it } from "vitest";
import { externalOperationCount, findExternalOperation } from "./contract-surface";

describe("external client allowlist", () => {
  it("stays empty until a reviewed external operation exists", () => {
    expect(externalOperationCount()).toBe(0);
    expect(findExternalOperation("listTasks", "GET", "/tasks")).toBeUndefined();
  });
});
