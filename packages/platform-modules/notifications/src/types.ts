export type JsonPrimitive=null|boolean|number|string;
export type JsonValue=JsonPrimitive|readonly JsonValue[]|{readonly [key:string]:JsonValue};
export interface NotificationActor { readonly activeAssignmentIds?:readonly string[];readonly principalId:string }
export interface NotificationDeepLink { readonly applicationId:string;readonly routeId:string;readonly resourceType:string;readonly resourceId:string;readonly parameters?:Readonly<Record<string,string>> }
export interface RecipientSelector { readonly selectorType:string;readonly referenceId:string }
export interface ResolvedRecipient { readonly principalId:string;readonly recipientReference:string;readonly resolutionReference:string;readonly resolutionVersion:string }
export interface TemplateRelease { readonly templateKey:string;readonly version:number;readonly ownerReference:string;readonly notificationType:string;readonly variableSchema:Readonly<Record<string,unknown>>;readonly titleTemplate:string;readonly bodyTemplate:string;readonly contentDigest:string;readonly publishedAt:string }
export interface PublishTemplateCommand extends Omit<TemplateRelease,"contentDigest"|"publishedAt"> { readonly actor:NotificationActor;readonly publishedAt:string }
export interface NotificationIntent { readonly intentId:string;readonly producer:string;readonly idempotencyKey:string;readonly templateKey:string;readonly templateVersion:number;readonly selectors:readonly RecipientSelector[];readonly variables:Readonly<Record<string,JsonValue>>;readonly sourceType:string;readonly sourceId:string;readonly deepLink:NotificationDeepLink }
export interface NotificationIntentResult { readonly intentId:string;readonly notificationIds:readonly string[];readonly status:"accepted" }
export type PreferenceDecision="deliver"|"suppress";
export interface NotificationPreference { evaluate(input:{readonly notificationType:string;readonly recipient:ResolvedRecipient}):Promise<{readonly decision:PreferenceDecision;readonly reason:string;readonly version:string}> }
export interface InAppNotification { readonly notificationId:string;readonly intentId:string;readonly principalId:string;readonly recipientReference:string;readonly resolutionReference:string;readonly resolutionVersion:string;readonly templateKey:string;readonly templateVersion:number;readonly notificationType:string;readonly title:string;readonly body:string;readonly sourceType:string;readonly sourceId:string;readonly deepLink:NotificationDeepLink;readonly preferenceDecision:PreferenceDecision;readonly preferenceReason:string;readonly preferenceVersion:string;readonly createdAt:string;readonly readAt?:string;readonly archivedAt?:string }
export interface NotificationQuery { readonly actor:NotificationActor;readonly limit?:number;readonly cursor?:string;readonly includeArchived?:boolean }
export interface NotificationPage { readonly items:readonly InAppNotification[];readonly nextCursor?:string }
export interface ArchiveNotificationCommand { readonly actor:NotificationActor;readonly notificationId:string }
export type NotificationOperation="notification_archive"|"notification_detail"|"notification_intent_submit"|"notification_list"|"notification_mark_read"|"notification_template_publish"|"notification_unread_count";
export interface NotificationAuthorization { authorize(input:{readonly actor:NotificationActor;readonly operation:NotificationOperation;readonly notificationId?:string;readonly ownerReference?:string;readonly producerReference?:string}):Promise<{readonly allowed:boolean;readonly decisionId:string}> }
export interface NotificationAudit { record(input:{readonly actor:NotificationActor;readonly operation:NotificationOperation;readonly phase:"attempted"|"failed"|"succeeded";readonly decisionId:string;readonly referenceId:string;readonly errorCode?:string}):Promise<void> }
export interface NotificationObserver { record(input:{readonly operation:NotificationOperation;readonly outcome:"completed"|"denied"|"duplicate"|"failed";readonly durationMs:number}):void }
export interface NotificationRecipientResolver { resolve(selectors:readonly RecipientSelector[]):Promise<readonly ResolvedRecipient[]> }
export interface StoredIntent { readonly intentId:string;readonly producer:string;readonly idempotencyKey:string;readonly fingerprint:string;readonly result:NotificationIntentResult;readonly createdAt:string }
export interface NotificationStore {
  publishTemplate(release:TemplateRelease):Promise<"published"|"duplicate">;
  getTemplate(templateKey:string,version:number):Promise<TemplateRelease|undefined>;
  findIntent(producer:string,idempotencyKey:string):Promise<StoredIntent|undefined>;
  acceptIntent(input:{readonly intent:StoredIntent;readonly notifications:readonly InAppNotification[]}):Promise<{readonly status:"created"|"duplicate";readonly result:NotificationIntentResult}>;
  get(principalId:string,notificationId:string):Promise<InAppNotification|undefined>;
  list(input:{readonly principalId:string;readonly limit:number;readonly cursor?:string;readonly includeArchived:boolean}):Promise<NotificationPage>;
  unreadCount(principalId:string):Promise<number>;
  markRead(principalId:string,notificationId:string,at:string):Promise<InAppNotification|undefined>;
  archive(principalId:string,notificationId:string,at:string):Promise<InAppNotification|undefined>;
}
export interface NotificationCenter {
  publishTemplate(command:PublishTemplateCommand):Promise<TemplateRelease>;
  submitIntent(actor:NotificationActor,intent:NotificationIntent):Promise<NotificationIntentResult>;
  get(actor:NotificationActor,notificationId:string):Promise<InAppNotification>;
  list(query:NotificationQuery):Promise<NotificationPage>;
  unreadCount(actor:NotificationActor):Promise<number>;
  markRead(command:ArchiveNotificationCommand):Promise<InAppNotification>;
  archive(command:ArchiveNotificationCommand):Promise<InAppNotification>;
}
