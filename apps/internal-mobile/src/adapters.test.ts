import { describe, expect, it, vi } from "vitest";
import { createTaroH5Adapters, type TaroAdapterApi } from "./adapters";
import { internalMobileOperations, operationById, type InternalMobileOperation } from "./contract-surface";

vi.mock("@tarojs/taro", () => ({ default: {} }));

function createApi(overrides: Partial<TaroAdapterApi> = {}): TaroAdapterApi {
  return {
    getCurrentInstance: () => ({ router: { params: { page: "2" } } }),
    navigateTo: vi.fn().mockResolvedValue(undefined),
    redirectTo: vi.fn().mockResolvedValue(undefined),
    getNetworkType: vi.fn().mockResolvedValue({ networkType: "wifi" }),
    onNetworkStatusChange: vi.fn(),
    offNetworkStatusChange: vi.fn(),
    chooseImage: vi.fn().mockResolvedValue({ tempFilePaths: ["temporary://picked-image"] }),
    request: vi.fn().mockResolvedValue({ data: { ok: true }, statusCode: 200 }),
    ...overrides,
  };
}

describe("Taro H5 adapters", () => {
  it("allowlists only reviewed generated Task read operations", () => {
    expect(internalMobileOperations.map((operation) => operation.id)).toEqual(["listTasks", "getTask"]);
    expect(() => operationById("listTasks")).not.toThrow();
    expect(internalMobileOperations.map((operation) => String(operation.id))).not.toContain("completeTask");
  });

  it("uses Taro navigation and preserves current URL parameters", async () => {
    const api = createApi();
    const adapters = createTaroH5Adapters(api);
    expect(adapters.navigation.currentParameters()).toEqual({ page: "2" });
    await adapters.navigation.navigate("/pages/tasks/index?page=1");
    await adapters.navigation.replace("/pages/home/index");
    expect(api.navigateTo).toHaveBeenCalledWith({ url: "/pages/tasks/index?page=1" });
    expect(api.redirectTo).toHaveBeenCalledWith({ url: "/pages/home/index" });
  });

  it("subscribes and unsubscribes the exact network listener", () => {
    const api = createApi();
    const listener = vi.fn();
    const unsubscribe = createTaroH5Adapters(api).connectivity.subscribe(listener);
    const receive = vi.mocked(api.onNetworkStatusChange).mock.calls[0]?.[0];
    expect(receive).toBeDefined();
    receive?.({ isConnected: false });
    expect(listener).toHaveBeenCalledWith(false);
    unsubscribe();
    expect(api.offNetworkStatusChange).toHaveBeenCalledWith(receive);
  });

  it("reads the initial network state before relying on change events", async () => {
    const online = createTaroH5Adapters(createApi()).connectivity;
    await expect(online.current()).resolves.toBe(true);
    const offline = createTaroH5Adapters(createApi({ getNetworkType: vi.fn().mockResolvedValue({ networkType: "none" }) })).connectivity;
    await expect(offline.current()).resolves.toBe(false);
  });

  it("treats file selection as a temporary reference and cancellation as non-success", async () => {
    const selected = createTaroH5Adapters(createApi()).filePicker;
    await expect(selected.pickImage()).resolves.toEqual({ kind: "selected", temporaryPath: "temporary://picked-image" });

    const cancelled = createTaroH5Adapters(createApi({ chooseImage: vi.fn().mockRejectedValue(new Error("cancelled")) })).filePicker;
    await expect(cancelled.pickImage()).resolves.toEqual({ kind: "cancelled" });
  });

  it("uses Cookie transport without constructing an authorization header", async () => {
    const api = createApi();
    const result = await createTaroH5Adapters(api).transport.request(operationById("listTasks"), { cursor: "next value" });
    expect(result).toEqual({ ok: true });
    expect(api.request).toHaveBeenCalledWith({
      url: "/tasks?cursor=next+value",
      method: "GET",
      credentials: "include",
      header: { Accept: "application/json" },
    });
    expect(JSON.stringify(vi.mocked(api.request).mock.calls)).not.toContain("Authorization");
  });

  it("rejects non-allowlisted or forged generated operations before transport", async () => {
    const api = createApi();
    const transport = createTaroH5Adapters(api).transport;
    const unapproved = { id: "completeTask", method: "POST", path: "/tasks/x/y/complete" } as unknown as InternalMobileOperation;
    const forged = { ...operationById("listTasks"), path: "/auth/pc/session" } as unknown as InternalMobileOperation;
    await expect(transport.request(unapproved)).rejects.toThrow("not allowlisted");
    await expect(transport.request(forged)).rejects.toThrow("not allowlisted");
    expect(api.request).not.toHaveBeenCalled();
  });

  it("fails closed when Taro resolves a non-success HTTP response", async () => {
    const api = createApi({ request: vi.fn().mockResolvedValue({ data: { code: "forbidden" }, statusCode: 403 }) });
    await expect(createTaroH5Adapters(api).transport.request(operationById("listTasks")))
      .rejects.toThrow("internal_mobile_transport_http_failure");
  });

  it("fails closed while the reviewed internal login contract is pending", () => {
    expect(createTaroH5Adapters(createApi()).session.login()).toEqual({ kind: "contract-pending" });
  });
});
