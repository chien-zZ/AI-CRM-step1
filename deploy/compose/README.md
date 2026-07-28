# Compose Environments

Expected definitions cover local development, isolated CI/testing, staging, and production. Production has a separate Compose project and explicit service-placement overlay for each of the two hosts; no file may imply that Docker Compose schedules across hosts.

Do not add placeholder services until component versions, ports, persistence, health checks, resource limits, shutdown behavior, backup responsibility, and host placement are reviewed. Production definitions must not contain default passwords, literal secrets, floating image versions, public state-service ports, or destructive Volume lifecycle commands.

Production services declare named Compose `secrets` or reviewed read-only single-file mounts. Compose contains only the host reference path and container target; each service receives only its own Secret files. A production `.env` may not store Secret values, and unsupported third-party images require a reviewed file-to-process adapter rather than copying values into the image or command line.

See [ADR-0021](../../docs/08-架构决策/ADR-0021-第一阶段两台云服务器Docker-Compose部署.md) and [ADR-0023](../../docs/08-架构决策/ADR-0023-文件式Secret与两台主机安全基线.md).

## Local development

Run `pnpm compose:dev:prepare` once, then `pnpm compose:dev:up`. The prepare command creates random development-only Secret files under the ignored `deploy/compose/.runtime/dev/` directory and preserves existing files. Development ports bind only to `127.0.0.1`.

Stop services with `pnpm compose:dev:down`. This preserves named Volumes. Deliberate Volume deletion must use an explicit project name and is never part of normal shutdown.

## Isolated tests

Create test Secrets with `pnpm compose:test:prepare`. Test runs must use a unique project name such as `ai-crm-test-<run-id>` and combine `compose.base.yml` with `compose.test.yml`. The test overlay publishes no host ports. Project-scoped named Volumes isolate every run.

Delete an isolated test environment with `node scripts/bootstrap/cleanup-test-compose.mjs ai-crm-test-<run-id>`. The cleanup command rejects project names outside the `ai-crm-test-*` namespace before it passes `--volumes` to Docker Compose.

`pnpm compose:check` performs the static safety check. Production definitions are intentionally absent from INF-01; two-host placement, production Secret mounts and release behavior belong to OPS-01 after capacity and ownership review.

`compose.postgres-test.yml` is a narrow DAT-01 integration overlay. It requires an explicit unused loopback port and must run under a unique `ai-crm-test-*` project; it is not a development or production definition.

`pnpm db:test:integration` runs the empty-database migration test on loopback port 55432 by default. It creates a system-temporary Secret directory and a unique `ai-crm-test-g1-postgres-<run-id>` project, then removes only that project and directory in its cleanup path. Set `AI_CRM_TEST_POSTGRES_PORT` to another unused loopback port when necessary.

`pnpm compose:test:integration` likewise uses a unique `ai-crm-test-g1-compose-<run-id>` project, so concurrent runs cannot remove each other's containers, networks, or Volumes.

## RabbitMQ TLS integration

Run `node scripts/check/run-rabbitmq-integration.mjs` to validate RabbitMQ `4.2.9` against the repository-pinned `amqplib@2.0.1`. The runner requires Docker and OpenSSL, creates all certificates and credentials in a system-temporary directory, publishes only an automatically selected loopback AMQPS port, and removes its unique Compose project, Volume, network, and fixture directory in `finally` cleanup.

The fixture disables plaintext AMQP, uses a private CA with hostname verification, creates only the isolated `ai-crm-integration` VHost, and supplies separate publisher and consumer users. Its definitions pre-create the synthetic exchange, queue, and binding so neither runtime user needs configure permission. The publisher can write only the test exchange and cannot read the queue; the consumer can read only the test queue and cannot publish.

This is local/CI compatibility evidence, not production activation, capacity evidence, an image digest approval, or permission to reuse the generated credentials. Set `AI_CRM_TEST_RABBITMQ_TLS_PORT` only when CI reserves an explicit unused loopback port; otherwise the runner chooses a high ephemeral candidate and still fails closed on conflicts.
