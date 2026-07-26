import { internalOperations } from "@ai-crm/api-client";

export type InternalOperation = (typeof internalOperations)[number];
const approvedIds = new Set(["listTasks", "getTask"]);

export const internalMobileOperations = internalOperations.filter((operation) => approvedIds.has(operation.id));

export function operationById(id: "getTask" | "listTasks"): InternalOperation {
  const operation = internalMobileOperations.find((candidate) => candidate.id === id);
  if (!operation) throw new Error(`Generated internal operation ${id} is unavailable.`);
  return operation;
}
