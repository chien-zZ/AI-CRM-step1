export { NOTIFICATION_ERROR_CODES,NotificationError,type NotificationErrorCode } from "./errors.js";
export { InMemoryNotificationStore } from "./memory-store.js";
export { createPostgresNotificationStore,type NotificationPersistenceRuntime } from "./postgres-store.js";
export { createNotificationCenter } from "./service.js";
export type { ArchiveNotificationCommand,InAppNotification,NotificationActor,NotificationAudit,NotificationAuthorization,NotificationCenter,NotificationDeepLink,NotificationIntent,NotificationIntentResult,NotificationObserver,NotificationPage,NotificationPreference,NotificationQuery,NotificationRecipientResolver,NotificationStore,PublishTemplateCommand,RecipientSelector,ResolvedRecipient,TemplateRelease } from "./types.js";
export const packageId = "@ai-crm/platform-notifications" as const;
