export type AuditResult = "attempted" | "denied" | "failed" | "succeeded";
export type AuditScalar = boolean | number | string | null;

export interface AuditActor {
  readonly actorId: string;
  readonly actorType: "authenticated_subject" | "system";
  readonly assignmentId?: string;
  readonly workforcePersonId?: string;
}

export interface AuditResource {
  readonly resourceId: string;
  readonly resourceType: string;
}

export type AuditChange =
  | { readonly after?: AuditScalar; readonly before?: AuditScalar; readonly classification: "non_sensitive"; readonly field: string }
  | { readonly changed: true; readonly classification: "sensitive"; readonly field: string };

export interface AuditRecord {
  readonly action: string;
  readonly actor: AuditActor;
  readonly auditId: string;
  readonly changes?: readonly AuditChange[];
  readonly occurredAt: string;
  readonly reason: { readonly code: string; readonly detail?: string };
  readonly resource: AuditResource;
  readonly result: AuditResult;
  readonly trace: {
    readonly authorizationDecisionId?: string;
    readonly operationId: string;
    readonly traceId: string;
  };
  readonly version: 1;
}

export interface RecordAuditCommand extends Omit<AuditRecord, "auditId" | "occurredAt" | "version"> {
  readonly auditId?: string;
  readonly occurredAt?: string;
}

export interface SensitiveAuditAccessCommand {
  readonly actor: AuditActor;
  readonly operationId: string;
  readonly reason: string;
  readonly recordId: string;
  readonly traceId: string;
}

export interface AuditAuthorizationDecision {
  readonly allowed: boolean;
  readonly decisionId: string;
}

export interface AuditAuthorizer {
  authorize(request: {
    readonly action: "audit:read_sensitive";
    readonly actor: AuditActor;
    readonly resource: AuditResource;
  }): Promise<AuditAuthorizationDecision>;
}

export interface AuditService {
  readSensitive(command: SensitiveAuditAccessCommand): Promise<AuditRecord>;
  record(command: RecordAuditCommand): Promise<{ readonly auditId: string; readonly replayed: boolean }>;
}

export interface AuditFieldPolicy {
  readonly classification: "non_sensitive" | "sensitive";
  readonly field: string;
}

export interface AuditServiceOptions {
  readonly clock?: () => Date;
  readonly fieldPolicies: Readonly<Record<string, readonly AuditFieldPolicy[]>>;
  readonly id?: () => string;
}
