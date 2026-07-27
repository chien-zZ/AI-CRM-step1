import { externalOperations } from "@ai-crm/api-client/external";

const externalOperationList: readonly Readonly<{ id: string; method: string; path: string }>[] = externalOperations;
export type ExternalOperation = (typeof externalOperationList)[number];

export function findExternalOperation(id: string, method: string, path: string): ExternalOperation | undefined {
  return externalOperationList.find((operation) => operation.id === id && operation.method === method && operation.path === path);
}

export function externalOperationCount(): number {
  return externalOperationList.length;
}
