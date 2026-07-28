# Integration Tests

Cross-module tests using real infrastructure dependencies where behavior cannot be proven by unit or contract tests.

`rabbitmq-tls.mjs` is executed through `node scripts/check/run-rabbitmq-integration.mjs`. It verifies the real RabbitMQ `4.2.9` / `amqplib@2.0.1` TLS boundary: trusted CA and hostname success, untrusted/missing CA rejection, hostname rejection, unknown VHost rejection, publisher/consumer permission denial, Confirm, Mandatory Return, manual ACK, and redelivery after an unsettled connection closes.

The test consumes only synthetic payloads and temporary credentials. It does not use a production account, enable a Worker consumer, call the management API, claim throughput, or prove production topology/recovery.
