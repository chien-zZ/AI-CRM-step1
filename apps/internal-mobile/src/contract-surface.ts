import { internalOperations } from "@ai-crm/api-client";

export type InternalOperation = (typeof internalOperations)[number];
export type InternalMobileOperationId = "getTask" | "listTasks";
export type InternalMobileOperation = Extract<InternalOperation, { readonly id: InternalMobileOperationId }>;
const approvedIds = new Set<InternalMobileOperationId>(["listTasks", "getTask"]);

function isInternalMobileOperation(operation: InternalOperation): operation is InternalMobileOperation {
  return approvedIds.has(operation.id as InternalMobileOperationId);
}

export const internalMobileOperations = internalOperations.filter(isInternalMobileOperation);

export function operationById(id: InternalMobileOperationId): InternalMobileOperation {
  const operation = internalMobileOperations.find((candidate) => candidate.id === id);
  if (!operation) throw new Error(`Generated internal operation ${id} is unavailable.`);
  return operation;
}

export function approvedOperation(operation: InternalMobileOperation): InternalMobileOperation {
  const candidate: { readonly id: string; readonly method: string; readonly path: string } = operation;
  const generated = internalMobileOperations.find((item) => item.id === candidate.id);
  if (!generated || generated.method !== candidate.method || generated.path !== candidate.path) {
    throw new Error("Internal mobile operation is not allowlisted.");
  }
  return generated;
}
