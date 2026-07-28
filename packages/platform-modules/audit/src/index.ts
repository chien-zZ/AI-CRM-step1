export const packageId = "@ai-crm/platform-audit" as const;
export { createPostgresAuditCapabilityProbe, type AuditCapabilityProbe, type AuditCapabilityStatus } from "./capability-probe.js";
export { AuditError, type AuditErrorCode } from "./errors.js";
export { createMemoryAuditStore } from "./memory-store.js";
export { createPostgresAuditStore } from "./postgres-store.js";
export { createAuditService } from "./service.js";
export type { AuditPersistenceRuntime } from "./store.js";
export type { AuditActor, AuditAuthorizer, AuditChange, AuditFieldPolicy, AuditRecord, AuditResource, AuditResult, AuditService, AuditServiceOptions, RecordAuditCommand, SensitiveAuditAccessCommand } from "./types.js";
