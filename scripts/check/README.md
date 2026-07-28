# Check Scripts

Repository structure, dependency boundaries, generated-contract drift, migration safety, and documentation checks.

`verify-worker-drain.mjs` consumes a fully rendered Host B Compose document from a file or standard input (`-`) and numerically parses Docker Compose duration units. It fails unless the positive integer application drain seconds are strictly less than `stop_grace_period`; unresolved variable expressions and mere string presence are rejected.

`run-rabbitmq-integration.mjs` owns a unique `ai-crm-test-rabbitmq-<run-id>` Compose project and a system-temporary TLS fixture. It fails when Docker, OpenSSL, fixture generation, Broker readiness, or any protocol assertion fails, prints bounded Broker diagnostics on failure, and always attempts scoped cleanup.
