export const applicationId = "@ai-crm/internal-mobile" as const;
export { createTaroH5Adapters } from "./adapters";
export { internalMobileOperations, operationById } from "./contract-surface";
export { normalizeRouteState, normalizeSection, normalizeStatus, sectionPath } from "./route-state";
export type { InternalMobilePort, MobileBootstrapResult, MobileItem, MobileSection, MobileStatus } from "./workbench-port";
