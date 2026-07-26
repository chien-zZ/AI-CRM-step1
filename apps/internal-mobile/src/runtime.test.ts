import { describe, expect, it } from "vitest";
import { runtimeInternalMobilePort } from "./runtime.production";

describe("production runtime", () => {
  it("fails closed instead of loading a development fixture", async () => {
    await expect(runtimeInternalMobilePort.bootstrap()).resolves.toEqual({ kind: "maintenance" });
  });
});
