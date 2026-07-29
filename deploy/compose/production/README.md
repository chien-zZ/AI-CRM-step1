# Production Two-host Compose Baseline

This directory defines two independent projects. `compose.host-a.yml` is always deployed as `ai-crm-prod-a`; `compose.host-b.yml` is always deployed as `ai-crm-prod-b`. They do not share a Docker network and must never be combined into a cross-host Compose command.

## Placement And Accepted Limitation

| Host | Long-running services | Failure meaning |
|---|---|---|
| Host A | Edge, API A, PostgreSQL, Redis, RabbitMQ, Keycloak, Flowable, ClamAV | State services and the primary entry remain single points of failure; recovery or an approved manual entry switch is required. |
| Host B | Edge, API B, Worker | Preserves a second API/edge artifact and isolates background execution, but does not make Host A state services highly available. |

Both edges use the same versioned Nginx template and can reach API A/API B through reviewed private addresses. Only edge ports 80/443 are public. Published API and state ports bind a specific private address and require least-privilege security-group rules; management UIs are not published.

The placement is a first-stage baseline, not a capacity claim. CPU, memory, disk, connection, queue and timeout values remain mandatory deployment inputs and must be approved from measured staging evidence.

## Configuration Boundary

- A reviewed release manifest supplies the release ID and immutable image references.
- A root-owned, non-secret host variables file supplies reviewed domain, private addresses, resource limits and bounded runtime values. `host-configuration.example.vars` is intentionally non-runnable until every `replace-after-*` value is resolved.
- A root-owned restricted directory supplies individual Secret files. Do not put Secret values in either variables file, the shell command line, Compose YAML, images or release records.
- CMP-01 has bound API runtime parameters, the per-service `api_postgres_url`, API-specific COS credential references and the independent Worker database/Rabbit credential references. OPS-G3 defines migration-artifact integrity and rendered Worker drain/stop-grace gates; the image build/release pipeline must retain their evidence. Production remains blocked until the real non-empty authorization policy, COS conformance, immutable image digests and Worker Rabbit activation evidence are accepted.

## Required Secret Files

Host A receives only the files declared by its Compose services: PostgreSQL role files, Redis credentials, RabbitMQ server CA/certificate/key plus separate Publisher/Consumer usernames and passwords, the Keycloak database credential, the Flowable bootstrap credential, the API-only PostgreSQL URL, API-specific COS ID/key, API BFF session files and edge TLS certificate/key files. Host B receives the API-only and Worker-only PostgreSQL URL files, API-specific COS ID/key, shared API BFF session files, edge TLS certificate/key files, and only the RabbitMQ CA and separate Publisher/Consumer credentials required by Worker. The API URL must authenticate as `ai_crm_runtime`; the Worker URL must authenticate as `ai_crm_worker_runtime`, and both applications fail readiness when their fixed identity probe observes another role. Each file is environment/service/purpose specific. Because standalone Compose file-backed Secrets preserve host file permissions while the consumers are non-root, every mounted production Secret is root-owned, assigned to a dedicated numeric Secret-reader group and `0440`. The Secret directory remains root-owned and non-traversable by ordinary host users; no human deployment account is a standing member of the reader group.

The base Host A and Host B files do not declare, reference or mount a previous BFF session encryption key. During an approved one-key rotation window only, add the matching `compose.host-a.bff-previous-key.yml` or `compose.host-b.bff-previous-key.yml` overlay. Enabling the overlay requires the non-secret previous key ID and the single host file `pc_session_previous_encryption_key`; it exposes only the paired `AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_ID` and typed `AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_FILE` inputs to that host's API. A missing ID, Secret root or named file fails closed. Remove both overlays after the approved session compatibility window; never retain more than one previous key or reuse current/index key files.

The long-running Keycloak service deliberately does not receive a bootstrap administrator credential. Initial administrator establishment or recovery is a separately approved, audited one-time operation; its temporary credential is revoked after use and is never retained in the normal Compose project.

Do not mount the Secret root. Compose resolves each declared file and mounts only the named Secret into the consuming container. A service receives the approved supplementary reader GID only when it declares Secret mounts, so group membership does not reveal unmounted files. Missing files, wrong ownership/mode or GID mismatch fail before deployment.

## Static Verification

```text
node scripts/deploy/verify-release.mjs <approved-release.json>
node scripts/deploy/render-release-variables.mjs <approved-release.json> production > <root-owned-release-dir>/images.vars.tmp
pnpm compose:check
node scripts/check/run-production-edge-integration.mjs
```

Restrict and atomically rename `images.vars.tmp` after validation. It contains no Secret, but it is still controlled release metadata. Validate each project with its own two non-secret variable files before pulling or changing containers:

```text
docker compose --env-file <images.vars> --env-file <host-a.vars> -p ai-crm-prod-a -f deploy/compose/production/compose.host-a.yml config --quiet
docker compose --env-file <images.vars> --env-file <host-b.vars> -p ai-crm-prod-b -f deploy/compose/production/compose.host-b.yml config --quiet
```

If the previous-key rotation overlay is approved, append only the matching host overlay to that host command. Do not add the previous-key variable or file for the ordinary base deployment:

```text
docker compose --env-file <images.vars> --env-file <host-a.vars> -p ai-crm-prod-a -f deploy/compose/production/compose.host-a.yml -f deploy/compose/production/compose.host-a.bff-previous-key.yml config --quiet
docker compose --env-file <images.vars> --env-file <host-b.vars> -p ai-crm-prod-b -f deploy/compose/production/compose.host-b.yml -f deploy/compose/production/compose.host-b.bff-previous-key.yml config --quiet
```

For every Host B release, render the concrete Compose configuration into a restricted temporary evidence file and run the numeric relationship gate before pull/up. The values remain reviewed deployment inputs; the repository does not guess them.

```text
docker compose --env-file <images.vars> --env-file <host-b.vars> -p ai-crm-prod-b -f deploy/compose/production/compose.host-b.yml config > <restricted-temporary-rendered-host-b.yml>
node scripts/check/verify-worker-drain.mjs <restricted-temporary-rendered-host-b.yml>
```

Alternatively pipe `docker compose ... config` directly to `node scripts/check/verify-worker-drain.mjs -` when a rendered evidence file is not required. Delete any temporary rendered file after its safe digest/result is retained. The gate parses compound `us`, `ms`, `s`, `m` and `h` durations and requires positive integer drain seconds to be strictly less than stop grace; unresolved placeholders, unitless durations and equality fail closed.

These static checks do not prove backup recovery, host hardening, alert delivery, data residency, performance or application correctness.
