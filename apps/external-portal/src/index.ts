export const applicationId = "@ai-crm/external-portal" as const;
export { createExternalTransport } from "./transport";
export { createH5SessionAdapter, createWeappSessionAdapter } from "./session-adapters";
export type { ExternalPortalPort, PortalBootstrapResult, PortalStatus } from "./portal-port";
