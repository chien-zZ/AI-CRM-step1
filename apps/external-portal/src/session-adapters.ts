export type SessionCredential = Readonly<{ kind: "h5-cookie" }> | Readonly<{ handle: string; kind: "weapp-handle" }>;

export interface SessionAdapter {
  clear(): void;
  credential(): SessionCredential | undefined;
  target: "h5" | "weapp";
}

export interface OpaqueHandleStore {
  clear(): void;
  read(): string | undefined;
  write(handle: string): void;
}

export function createMemoryHandleStore(): OpaqueHandleStore {
  let current: string | undefined;
  return {
    clear: () => { current = undefined; },
    read: () => current,
    write: (handle) => { current = handle; },
  };
}

export function createH5SessionAdapter(): SessionAdapter {
  return { target: "h5", credential: () => ({ kind: "h5-cookie" }), clear: () => undefined };
}

export function createWeappSessionAdapter(store: OpaqueHandleStore): SessionAdapter {
  return {
    target: "weapp",
    credential: () => {
      const handle = store.read();
      return handle === undefined || handle.length === 0 ? undefined : { kind: "weapp-handle", handle };
    },
    clear: () => { store.clear(); },
  };
}
