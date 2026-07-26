export const packageId = "@ai-crm/platform-file-center" as const;
export { FileCenterError, type FileCenterErrorCode } from "./errors.js";
export { LocalFileStorageAdapter } from "./local-storage-adapter.js";
export { MemoryFileCenterStore } from "./memory-store.js";
export { createPostgresFileCenterStore } from "./postgres-store.js";
export { createFileCenterService } from "./service.js";
export type { FileCenterPersistenceResult, FileCenterPersistenceRuntime, FileCenterStore } from "./store.js";
export type * from "./types.js";
