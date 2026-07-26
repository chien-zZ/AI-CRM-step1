export const EVENTING_ERROR_CODES = [
  "eventing_conflict",
  "eventing_invalid_input",
  "eventing_handler_timeout",
  "eventing_not_found",
  "eventing_operation_denied",
  "eventing_storage_unavailable",
] as const;

export type EventingErrorCode = (typeof EVENTING_ERROR_CODES)[number];

export class EventingError extends Error {
  constructor(public readonly code: EventingErrorCode, public readonly retryable = false) {
    super(code);
    this.name = "EventingError";
  }
}
