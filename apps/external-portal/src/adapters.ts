import Taro, { ENV_TYPE } from "@tarojs/taro";
import { createH5SessionAdapter, createMemoryHandleStore, createWeappSessionAdapter, type SessionAdapter } from "./session-adapters";
import { homePath, statusPath, type PortalView } from "./route-state";
import type { PortalStatus } from "./portal-port";

export interface PortalAdapters {
  connectivity: {
    current(): Promise<boolean>;
    subscribe(listener: (online: boolean) => void): () => void;
  };
  filePicker: {
    pickImage(): Promise<Readonly<{ kind: "cancelled" | "unavailable" }> | Readonly<{ kind: "selected"; localReference: string }>>;
  };
  navigation: {
    currentParameters(): Readonly<Record<string, string>>;
    home(view: PortalView): Promise<void>;
    status(status: PortalStatus): Promise<void>;
  };
  platform: "h5" | "weapp";
  session: SessionAdapter;
}

function parameters(): Readonly<Record<string, string>> {
  const values = Taro.getCurrentInstance().router?.params ?? {};
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export function createTaroPortalAdapters(): PortalAdapters {
  const platform = Taro.getEnv() === ENV_TYPE.WEAPP ? "weapp" : "h5";
  const handleStore = createMemoryHandleStore();
  return {
    platform,
    session: platform === "weapp" ? createWeappSessionAdapter(handleStore) : createH5SessionAdapter(),
    connectivity: {
      current: async () => (await Taro.getNetworkType()).networkType !== "none",
      subscribe: (listener) => {
        const callback = (event: { isConnected: boolean }): void => { listener(event.isConnected); };
        Taro.onNetworkStatusChange(callback);
        return () => { Taro.offNetworkStatusChange(callback); };
      },
    },
    filePicker: {
      pickImage: async () => {
        try {
          const result = await Taro.chooseImage({ count: 1, sourceType: ["album", "camera"] });
          const localReference = result.tempFilePaths[0];
          return localReference === undefined ? { kind: "cancelled" } : { kind: "selected", localReference };
        } catch (error) {
          return error instanceof Error && /cancel/iu.test(error.message) ? { kind: "cancelled" } : { kind: "unavailable" };
        }
      },
    },
    navigation: {
      currentParameters: parameters,
      home: async (view) => { await Taro.redirectTo({ url: homePath(view) }); },
      status: async (status) => { await Taro.redirectTo({ url: statusPath(status) }); },
    },
  };
}
