import type { WorkerHandler } from "./index.js";

const STABLE_HANDLER_ID = /^[a-z][a-z0-9._-]{0,127}$/u;

export interface WorkerHandlerRegistry {
  register(handler: WorkerHandler): void;
  handlers(): readonly WorkerHandler[];
}

export function createWorkerHandlerRegistry(): WorkerHandlerRegistry {
  const registered = new Map<string, WorkerHandler>();
  let sealed = false;
  return Object.freeze({
    register(handler: WorkerHandler): void {
      if (sealed) throw new Error("worker_handler_registry_sealed");
      if (!STABLE_HANDLER_ID.test(handler.name) || registered.has(handler.name)) throw new Error("worker_handler_id_invalid");
      registered.set(handler.name, Object.freeze(handler));
    },
    handlers(): readonly WorkerHandler[] {
      sealed = true;
      return Object.freeze([...registered.values()]);
    },
  });
}
