# G3 Production Composition Aggregate Handoff

- Status: CODE AND RELEASE GATES MERGED; PRODUCTION ACTIVATION EVIDENCE BLOCKED
- Date: 2026-07-29
- Owner: CMP-01 Integration Owner

## Known facts

- The accepted asynchronous contract owns only the Task projection route. Notification, Workflow and File jobs have no reviewed queue/job contract, so production handlers for them cannot be invented.
- The accepted authorization model requires a complete non-empty current policy, a real Organization-owned active Assignment, protected publication, management audit and distinct release roles. Repository tests cannot create the real people, Assignment or production publication fact.
- Production COS, RabbitMQ TLS/CAM, alert deployment, recovery drill and registry digest evidence are external release inputs. Synthetic integration tests are not substitutes.
- API and Worker use distinct fixed PostgreSQL roles and file-backed connection Secrets. Worker uses separate Rabbit publisher/consumer accounts and an isolated AMQPS VHost.

## Allowed assumptions used

- The project-owner G3 instruction confirms role-based publication responsibility: Authorization Owner submits, an independent Reviewer reviews, the project owner approves/result-owns and the protected Production Release Operator executes; the emergency route retains approval, non-executing review, management audit and post-event access revocation.
- Release-time numeric Outbox, timeout and capacity values remain mandatory configuration supplied by reviewed evidence rather than production defaults.
- Both API replicas may use service/purpose-specific COS credentials with the same reviewed Bucket/Region; credential values remain outside Git.

## Forbidden assumptions preserved

- No person name, Workforce Person/Assignment UUID, production Secret, Bucket, certificate, image digest, alert receipt or recovery result is fabricated.
- No startup seed, default administrator, direct policy-table write, plaintext AMQP, default VHost, automatic DLQ replay or broad database grant is introduced.
- No Notification, Workflow, File or generic Job queue/consumer is created without a reviewed owning contract.
- No HA, automatic failover, SLA, RPO or RTO claim is made.

## Non-goals

- Creating CRM business modules, a Workflow durable Ledger/HTTP contract, provider-specific job contracts, a first-policy approval-verifier protocol, or external production evidence.
- Executing production changes, publishing images, enabling consumers or declaring G3 passed from this workstation.

## Delivered code and gates

- Authorization governance, optimistic first/replacement publication preconditions, protected command/audit boundary, separate `platform.authorization.policy:publish` management permission catalog and complete assignment-scoped baseline compiler.
- API production composition for PostgreSQL Authorization/Audit/Organization, Registry/Form/File, Task and Notification queries; required readiness covers fixed API role, complete policy, capability SQL, File Center database access and COS `HeadBucket`.
- Tencent COS adapter, ClamAV INSTREAM scanner, stable failure classification, synthetic conformance tests and opt-in real test-Bucket conformance suite. Both production APIs receive reviewed non-secret COS settings and API-specific file Secrets.
- Worker production composition for the only accepted route: Outbox publisher plus Rabbit Inbox/Task projection handler sharing abortable PostgreSQL transaction state. Fixed retry/DLQ topology, explicit activation, bounded drain and health loss are fail-closed.
- Dedicated `ai_crm_worker_runtime`, exact database grants, role probes, independent DB Secret, AMQPS-only Rabbit configuration, separate publisher/consumer Secrets and main-queue-only consumer read permission.
- Alert declaration, recovery runbook, non-root API/Worker Dockerfiles, commit-addressed image workflow and image-embedded migration manifest verification before push.

## External and contract blockers

1. Execute the first protected publication with real approved role/Assignment evidence and a concrete first-policy approval verifier plus Audit adapter. The policy-backed authorizer cannot authorize its own first policy.
2. Run the real COS conformance suite against the approved test Bucket and retain CAM/Secret/cleanup evidence.
3. Build and publish both images in the trusted pipeline and retain immutable registry digests plus embedded migration verification.
4. Supply production RabbitMQ certificate/VHost/rotation evidence, deploy alert rules with a named operational owner, perform Inbox/retry/DLQ recovery and drain drills, then update the reviewed AsyncAPI activation evidence and set the consumer flag true.
5. Review contracts before adding Notification, Workflow or File job consumers. Workflow additionally needs a durable production Ledger and typed application/provider composition.

## Review dimensions

- Authorization/audit: all supported API operations retain server-side authorization and durable audit; unsupported mutation/object routes fail closed. First-policy bootstrap remains explicit.
- Idempotency/transactions: publication and Audit IDs are stable; Inbox receipt and Task projection update share one local transaction; ACK follows commit; Outbox Confirm precedes completion.
- Migrations: global migration 0014 is additive and forward-fixed; startup never migrates or synchronizes schema.
- Observability: readiness and alert dimensions are bounded and exclude payloads, personal data and Secrets.
- Backward compatibility: only additive contracts/exports and the accepted Task v1 route are introduced.
- Failure behavior: missing policy, role, Secret, provider, broker, migration, activation or evidence keeps the relevant service Not Ready.

## Verification snapshot

- API 170 passed / 5 dependency-gated skipped.
- Worker 114 passed / 5 real-COS dependency-gated skipped.
- Authorization 53 passed / 5 dependency-gated skipped.
- PostgreSQL isolated integration 39/39 passed; synthetic Rabbit TLS matrix passed and resources were cleaned.
- Repository, Compose and targeted contract gates passed. Final `pnpm check` completed with 140/140 Turbo tasks; isolated PostgreSQL integration completed 39/39 after the final allow/deny matrix was added.

## Merge result

- Merged to local `main` as `e090dda feat(g3): compose production api and worker`; no remote merge is claimed.
- `output/` was not modified or committed.
- Repository-side CMP-01 implementation is complete; the gate remains `EVIDENCE_BLOCKED` until the external evidence above is accepted.
