# PRC-01 Workflow Facade

- Status: G2 accepted
- Branch: `codex/PRC-01-workflow-facade`
- Owner: current serial implementation pass

## Objective

Provide a stable, business-neutral Workflow Facade over Flowable definitions, versions, process instances, and human tasks.

## Known Facts

- ADR-0009 is accepted and makes Flowable the fact source for BPMN execution and approval tasks, not for domain state.
- The repository pins `flowable/flowable-rest:7.2.0` and supplies Flowable/PostgreSQL Secret files through Compose.
- ASY-01 is merged and supplies transport-neutral Eventing/Outbox/Inbox; application wiring remains CMP-01 work.

## Allowed Assumptions

- A synthetic executable BPMN containing one unassigned human task may be used only as a test asset.
- Stable subject/reference identifiers, definition keys and idempotency keys may be passed to Flowable after bounded validation.
- Flowable REST may be isolated behind a provider-neutral `WorkflowEngine` port with bounded timeout and stable error mapping.

## Forbidden Assumptions

- No CRM entity, approval route, approver role, condition, countersign rule, SLA, form field or domain state transition is inferred.
- Flowable REST DTOs, SDKs, credentials and database rows are not public module contracts.
- Flowable completion never proves that an owning domain module accepted a state change.
- Task Center, notifications, reminders and background jobs are not folded into Workflow.

## Non-goals

- Production BPMN routes, instance migration, external provider integration, CMP-01 wiring and Task Center projection are excluded.
- This task does not query or migrate Flowable-owned tables and does not add an application HTTP endpoint.

## Contract Changes

- Add transport-neutral workflow lifecycle Event v1 schemas and document the public Facade/error contract.

## Migration Changes

- None. Flowable owns its persistence. A durable command ledger implementation is a required composition dependency; the module exposes the port and a test-only memory implementation.

## Required Tests

- Authorization/audit failure closure, duplicate/conflicting commands, variable whitelist, unknown definition version, cancelled/completed/expired tasks, partial event failure, Flowable timeout/unavailability/protocol mapping, BPMN static safety and isolated real Flowable REST integration.

## Authorization And Audit

- Deploy, start, cancel, claim, release and complete authorize server-side and record attempted plus final outcome audit facts. Audit failure before mutation fails closed.

## Idempotency, Retry And Failure

- Every mutation has a bounded idempotency key and actor-scoped fingerprint. Identical concurrent commands return one stable result; conflicting payload or principal reuse fails.
- The Command Ledger claims before the remote action and retains completed results, per-task monotonic source revisions, and `reconciliation_required` outcomes. A production implementation must be durable and replica-safe; the memory implementation is test-only.
- Ambiguous mutating timeouts and successful writes followed by failed confirmation reads map to non-retryable `WORKFLOW_RECONCILIATION_REQUIRED`. Automatic retry returns the retained failure and never repeats the remote write.
- Durable Ledger composition and explicit operator reconciliation remain CMP-01/OPS work; no unknown outcome is interpreted as approval success.

## Observability And Health

- Bounded observer events contain operation, outcome, duration and stable error code only. Health reports Flowable availability without credentials or provider payloads.

## Backward Compatibility

- Public contracts and exports are additive; no existing HTTP, event or Job contract is changed.

## Unresolved Questions

- Production command-ledger composition, lifecycle Outbox wiring, Flowable credential rotation, production BPMN release/rollback and instance migration remain CMP-01/OPS follow-ups.

## Independent Review Repairs

- Hardened BPMN validation with `@xmldom/xmldom` namespace-aware parsing to exactly one matching executable process and a conservative first-stage human-task element/attribute allowlist. Validation uses namespace URI plus local name rather than QName regex, so underscore and Unicode prefixes cannot bypass it. DTD/entity declarations, additional processes, service/script/call/send/receive/rule tasks, listeners, provider execution attributes, and expressions are rejected before authorization. Deployment responses containing more than one definition are rejected.
- Added retained reconciliation state and status lookup. Remote mutating timeout/network/protocol ambiguity and write-then-read failure cannot trigger an automatic second write.
- Added actor identity to command fingerprints. Completion now validates the declared definition and variable allowlist before authorization, then verifies the actual instance definition before mutation.
- Added Ledger-allocated task-scoped `sourceRevision` to the task lifecycle contract. This replaced the initial assumption that Flowable REST exposed its internal task revision; real Flowable 7.2.0 integration proved that field is absent, and direct table access is forbidden.
- Normalized provider timestamps to UTC, bounded provider identifiers and keys, added mapper-versus-JSON-Schema tests, stream-limited response bytes, checked `Content-Length`, rejected redirects, and preserved bounded telemetry.

## Verification Evidence

- `pnpm --filter @ai-crm/platform-workflow lint`: passed.
- `pnpm --filter @ai-crm/platform-workflow typecheck`: passed.
- `pnpm --filter @ai-crm/platform-workflow test`: 42 passed, 1 integration test skipped by the unit runner.
- `pnpm contracts:check`: 28/28 package contract checks passed.
- `pnpm --filter @ai-crm/platform-workflow test:integration`: 1/1 passed against isolated PostgreSQL and Flowable 7.2.0, covering deployment, exact version query, start, list, claim, release, complete, history, cancel, and cleanup.
- `pnpm check`: 140/140 tasks passed.
- `git diff --check`: passed.
- PRC-01 integration containers, network, volume, and temporary test resources were removed; no matching Docker residue remains.
- After the second-review QName finding, the namespace-aware parser change and underscore/Unicode-prefix regression tests were included, and the module integration plus full `pnpm check` evidence above were rerun successfully.

## Independent Review Conclusion

- Final independent review found no P0/P1/P2 and accepted PRC-01 at G2.
- The only residual risk is routine XML parser dependency maintenance; `@xmldom/xmldom` is pinned to `0.9.10` and must follow normal security update review.
