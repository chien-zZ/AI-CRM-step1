import Taro from "@tarojs/taro";
import { approvedOperation, type InternalMobileOperation } from "./contract-surface";

export interface NavigationAdapter {
  currentParameters(): Readonly<Record<string, string>>;
  navigate(url: string): Promise<void>;
  replace(url: string): Promise<void>;
}

export interface ConnectivityAdapter {
  current(): Promise<boolean>;
  subscribe(listener: (online: boolean) => void): () => void;
}

export interface FilePickerAdapter {
  pickImage(): Promise<{ readonly kind: "cancelled" } | { readonly kind: "selected"; readonly temporaryPath: string }>;
}

export interface SessionAdapter {
  login(): { readonly kind: "contract-pending" };
}

export interface TransportAdapter {
  request(operation: InternalMobileOperation, query?: Readonly<Record<string, string>>): Promise<unknown>;
}

export interface TaroAdapterApi {
  getCurrentInstance(): { router?: { params?: Record<string, string> } };
  navigateTo(input: { url: string }): Promise<unknown>;
  redirectTo(input: { url: string }): Promise<unknown>;
  getNetworkType(): Promise<{ networkType: string }>;
  onNetworkStatusChange(listener: (result: { isConnected: boolean }) => void): void;
  offNetworkStatusChange(listener: (result: { isConnected: boolean }) => void): void;
  chooseImage(input: { count: number }): Promise<{ tempFilePaths: string[] }>;
  request(input: Record<string, unknown>): Promise<{ data: unknown; statusCode: number }>;
}

export function createTaroH5Adapters(api: TaroAdapterApi = Taro as unknown as TaroAdapterApi): {
  connectivity: ConnectivityAdapter;
  filePicker: FilePickerAdapter;
  navigation: NavigationAdapter;
  session: SessionAdapter;
  transport: TransportAdapter;
} {
  return {
    navigation: {
      currentParameters: () => ({ ...(api.getCurrentInstance().router?.params ?? {}) }),
      navigate: async (url) => { await api.navigateTo({ url }); },
      replace: async (url) => { await api.redirectTo({ url }); },
    },
    connectivity: {
      current: async () => (await api.getNetworkType()).networkType !== "none",
      subscribe: (listener) => {
        const receive = (result: { isConnected: boolean }): void => { listener(result.isConnected); };
        api.onNetworkStatusChange(receive);
        return () => { api.offNetworkStatusChange(receive); };
      },
    },
    filePicker: {
      pickImage: async () => {
        try {
          const result = await api.chooseImage({ count: 1 });
          const temporaryPath = result.tempFilePaths[0];
          return temporaryPath === undefined ? { kind: "cancelled" } : { kind: "selected", temporaryPath };
        } catch {
          return { kind: "cancelled" };
        }
      },
    },
    session: { login: () => ({ kind: "contract-pending" }) },
    transport: {
      request: async (operation, query = {}) => {
        const reviewedOperation = approvedOperation(operation);
        const suffix = new URLSearchParams(query).toString();
        const response = await api.request({
          url: `${reviewedOperation.path}${suffix.length === 0 ? "" : `?${suffix}`}`,
          method: reviewedOperation.method,
          credentials: "include",
          header: { Accept: "application/json" },
        });
        if (!Number.isInteger(response.statusCode) || response.statusCode < 200 || response.statusCode >= 300) {
          throw new Error("internal_mobile_transport_http_failure");
        }
        return response.data;
      },
    },
  };
}
