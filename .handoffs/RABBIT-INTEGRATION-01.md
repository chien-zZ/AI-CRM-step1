# RABBIT-INTEGRATION-01 RabbitMQ TLS Integration Gate

## Scope And Decisions

- Known facts: RabbitMQ `4.2.9` and `amqplib@2.0.1` are the validation pair; production requires TLS, an isolated VHost, role-separated least-privilege accounts, and file Secret references.
- Allowed assumptions: synthetic credentials and a two-day private test CA may exist only in a system-temporary directory; local/CI has Docker and OpenSSL; a unique Compose project can be destroyed after the run.
- Forbidden assumptions: no production Secret, plaintext AMQP, disabled certificate validation, production image digest/capacity claim, or production consumer activation.
- Non-goals: Worker implementation/composition, production deployment, CRM behavior, management API administration, performance or recovery certification.

## Delivered Boundary

- `compose.rabbitmq-integration.yml` pins `rabbitmq:4.2.9-management`, exposes only an explicit loopback `5671` mapping, and retains health, resource, log-rotation, and shutdown controls.
- `rabbitmq-integration-fixture.mjs` creates a private CA, hostname-bound server certificate, unrelated CA for negative testing, random publisher/consumer credentials, RabbitMQ SHA-256 password hashes, an isolated VHost, pre-created synthetic topology, and least-privilege definitions. Plaintext AMQP is disabled.
- `rabbitmq-tls.mjs` exercises the real Broker through `amqplib@2.0.1` and checks certificate, hostname, VHost, permission, Confirm, Return, ACK, and redelivery behavior.
- `run-rabbitmq-integration.mjs` fails closed, prints bounded diagnostics on failure, and always attempts deletion of only its unique project and temporary fixture.
- `verify-compose.mjs` statically locks the image, loopback TLS exposure, lifecycle limits, plaintext-listener disablement, peer verification, role separation, and permission regexes.

## Verification Evidence

- `node scripts/check/run-rabbitmq-integration.mjs`: passed against a real Docker RabbitMQ `4.2.9`; all ten matrix assertions passed and cleanup completed.
- `node scripts/check/verify-compose.mjs`: passed.
- `node --test scripts/check/*.test.mjs`: 40/40 passed.
- ESLint on the new/changed JavaScript integration boundary: passed with zero warnings.
- A deliberate invalid-port invocation exited non-zero before fixture creation, proving the runner's input gate.

## Eight-Dimension Review

1. Authorization and audit: two untagged users have disjoint regex permissions; the test offers no administration/replay path and creates no audit fact.
2. Idempotency: stable synthetic message IDs support Confirm/Return checks; the redelivery test explicitly proves at-least-once behavior rather than exactly-once.
3. Transactions: no database transaction exists; ACK is explicit, and closing with an unsettled delivery proves Broker redelivery.
4. Migrations and ownership: no schema, migration, module table, or contract changes.
5. Failure/retry/shutdown: missing tools, invalid port, fixture error, readiness failure, or assertion failure terminates non-zero; diagnostics are bounded; cleanup targets only the generated project/directory.
6. Observability/privacy: test output names only stable assertions; generated passwords are never printed; Broker failure logs can contain synthetic usernames but no application/customer payload.
7. Secrets/transport: credentials and keys are random temporary files; AMQP TCP is disabled; CA trust and hostname validation stay enabled; negative tests prove rejection paths.
8. Compatibility/activation: the gate is additive and directly executable without root package changes; it neither modifies Worker code nor enables a production consumer.

The review loop additionally replaced the initial whole-directory Broker mount with five explicit read-only file mounts. The Broker cannot read the test CA private key, unrelated negative-test CA material, plaintext client credentials, or VHost helper file. Port validation was also moved before temporary-directory creation so malformed input cannot leave fixture residue.

## Remaining Gaps

- Production image digest approval, CA issuance/rotation Owner, account/VHost names, credential mount ownership, and capacity remain deployment evidence, not inferred here.
- This fixture does not prove Broker resource alarms/Blocked behavior, cluster failover, backup/restore, TLS rotation, mTLS, fixed TTL/DLX timing, or production network controls.
- CI must explicitly invoke the runner and provide Docker/OpenSSL. The root package script and workflow were outside this task's path ownership.
