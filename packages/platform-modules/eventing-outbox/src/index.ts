export const packageId = "@ai-crm/platform-eventing-outbox" as const;
export { EventingError, EVENTING_ERROR_CODES, type EventingErrorCode } from "./errors.js";
export { createEventingCore } from "./service.js";
export { createOutboxPublisher, type OutboxPublisher } from "./publisher.js";
export { createEventingOperations } from "./operations.js";
export { createPostgresEventingStore, type EventingPersistenceResult, type EventingPersistenceRuntime } from "./postgres-store.js";
export { createRabbitConfirmTransport, handleRabbitDelivery, type RabbitConfirmChannel, type RabbitDelivery, type RabbitPublisherTopology, type RabbitRoute } from "./rabbit.js";
export type { EventingStore } from "./store.js";
export type { ConfirmingMessageTransport, ConsumptionResult, EventEnvelope, EventingBacklog, EventingCore, EventingObservation, EventingObserver, EventingOperationalControl, EventingReconciliationInput, EventingReconciliationReport, JobEnvelope, JobStatus, JsonValue, MessageHandler, OutboxPublication, PublishBatchResult, ValidatedMessage } from "./types.js";
