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
- CMP-01 must confirm the final API/Worker ports, health commands, runtime variables and per-service Secret consumers before the first production deployment.

## Required Secret Files

Host A receives only the files declared by its Compose services: PostgreSQL role files, Redis/RabbitMQ credentials, the Keycloak database credential, the Flowable bootstrap credential, API BFF session files and TLS certificate/key files. Host B receives the shared API BFF session files and TLS certificate/key files. Each file is environment/service/purpose specific, root-owned and normally `0400` (or an explicitly reviewed `0440`).

The long-running Keycloak service deliberately does not receive a bootstrap administrator credential. Initial administrator establishment or recovery is a separately approved, audited one-time operation; its temporary credential is revoked after use and is never retained in the normal Compose project.

Do not mount the Secret root. Compose resolves each declared file and mounts only the named Secret into the consuming container. Missing files fail before deployment.

## Static Verification

```text
node scripts/deploy/verify-release.mjs <approved-release.json>
node scripts/deploy/render-release-variables.mjs <approved-release.json> > <root-owned-release-dir>/images.vars.tmp
pnpm compose:check
node scripts/check/run-production-edge-integration.mjs
```

Restrict and atomically rename `images.vars.tmp` after validation. It contains no Secret, but it is still controlled release metadata. Validate each project with its own two non-secret variable files before pulling or changing containers:

```text
docker compose --env-file <images.vars> --env-file <host-a.vars> -p ai-crm-prod-a -f deploy/compose/production/compose.host-a.yml config --quiet
docker compose --env-file <images.vars> --env-file <host-b.vars> -p ai-crm-prod-b -f deploy/compose/production/compose.host-b.yml config --quiet
```

These static checks do not prove backup recovery, host hardening, alert delivery, data residency, performance or application correctness.
