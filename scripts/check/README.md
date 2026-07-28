# Check Scripts

Repository structure, dependency boundaries, generated-contract drift, migration safety, and documentation checks.

`verify-worker-drain.mjs` consumes a fully rendered Host B Compose document from a file or standard input (`-`) and numerically parses Docker Compose duration units. It fails unless the positive integer application drain seconds are strictly less than `stop_grace_period`; unresolved variable expressions and mere string presence are rejected.
