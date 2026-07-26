import { EventingError } from "./errors.js";
import type { EventingStore } from "./store.js";
import type { EventingOperationalControl, EventingReconciliationInput } from "./types.js";
import { validateConsumerName, validateReason, validateUuid } from "./validation.js";

export function createEventingOperations(store: EventingStore, control: EventingOperationalControl, clock: () => Date = () => new Date()) {
  return Object.freeze({ backlog: () => store.backlog(),reconcile(input:EventingReconciliationInput){if(input.expectedOutboxMessageIds.length>1000||input.expectedInbox.length>1000)throw new EventingError("eventing_invalid_input");return store.reconcile({expectedOutboxMessageIds:[...new Set(input.expectedOutboxMessageIds.map(validateUuid))],expectedInbox:input.expectedInbox.map(({messageId,consumer})=>({messageId:validateUuid(messageId),consumer:validateConsumerName(consumer)}))});}, async replayOutbox(messageIdInput: string, reasonInput: string): Promise<void> {
    const messageId = validateUuid(messageIdInput); const reason = validateReason(reasonInput); const decision = await control.authorize({ operation: "outbox_replay", referenceId: messageId });
    if (!decision.allowed) throw new EventingError("eventing_operation_denied");
    await control.record({ operation: "outbox_replay", referenceId: messageId, decisionId: decision.decisionId, reason });
    if (!(await store.replayOutbox(messageId, clock()))) throw new EventingError("eventing_not_found");
  } });
}
