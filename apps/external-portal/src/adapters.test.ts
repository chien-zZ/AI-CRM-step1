import { beforeEach, describe, expect, it, vi } from "vitest";

const taro = vi.hoisted(() => ({
  chooseImage: vi.fn(),
  getCurrentInstance: vi.fn(),
  getEnv: vi.fn(),
  getNetworkType: vi.fn(),
  offNetworkStatusChange: vi.fn(),
  onNetworkStatusChange: vi.fn(),
  redirectTo: vi.fn(),
}));

vi.mock("@tarojs/taro", () => ({ default: taro, ENV_TYPE: { H5: "WEB", WEAPP: "WEAPP" } }));

import { createTaroPortalAdapters } from "./adapters";

describe("Taro portal adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taro.getEnv.mockReturnValue("WEB");
    taro.getCurrentInstance.mockReturnValue({ router: { params: { view: "boundary", ignored: 3 } } });
    taro.getNetworkType.mockResolvedValue({ networkType: "wifi" });
    taro.redirectTo.mockResolvedValue(undefined);
  });

  it("isolates H5 Cookie semantics and approved local navigation", async () => {
    const adapters = createTaroPortalAdapters();
    expect(adapters.platform).toBe("h5");
    expect(adapters.session.credential()).toEqual({ kind: "h5-cookie" });
    expect(adapters.navigation.currentParameters()).toEqual({ view: "boundary" });
    await adapters.navigation.home("overview");
    await adapters.navigation.status("denied");
    expect(taro.redirectTo).toHaveBeenNthCalledWith(1, { url: "/pages/home/index?view=overview" });
    expect(taro.redirectTo).toHaveBeenNthCalledWith(2, { url: "/pages/status/index?kind=denied" });
  });

  it("creates a weapp adapter without fabricating a session handle", () => {
    taro.getEnv.mockReturnValue("WEAPP");
    const adapters = createTaroPortalAdapters();
    expect(adapters.platform).toBe("weapp");
    expect(adapters.session.credential()).toBeUndefined();
  });

  it("reports connectivity events and removes the exact listener", async () => {
    const adapters = createTaroPortalAdapters();
    expect(await adapters.connectivity.current()).toBe(true);
    const listener = vi.fn();
    const unsubscribe = adapters.connectivity.subscribe(listener);
    const callback = taro.onNetworkStatusChange.mock.calls[0]?.[0] as ((event: { isConnected: boolean }) => void) | undefined;
    callback?.({ isConnected: false });
    expect(listener).toHaveBeenCalledWith(false);
    unsubscribe();
    expect(taro.offNetworkStatusChange).toHaveBeenCalledWith(callback);
  });

  it("distinguishes selected, cancelled, and unavailable file capability results", async () => {
    const adapters = createTaroPortalAdapters();
    taro.chooseImage.mockResolvedValueOnce({ tempFilePaths: ["local://synthetic"] });
    await expect(adapters.filePicker.pickImage()).resolves.toEqual({ kind: "selected", localReference: "local://synthetic" });
    taro.chooseImage.mockRejectedValueOnce(new Error("user cancel"));
    await expect(adapters.filePicker.pickImage()).resolves.toEqual({ kind: "cancelled" });
    taro.chooseImage.mockRejectedValueOnce(new Error("dependency failure"));
    await expect(adapters.filePicker.pickImage()).resolves.toEqual({ kind: "unavailable" });
  });
});
