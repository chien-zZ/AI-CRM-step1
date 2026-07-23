# Business Configuration

Owns versioned business dictionaries and typed parameters, including definitions, immutable releases, effective-dated activation, historical resolution, audit references, and cache propagation.

It reuses PostgreSQL, Drizzle, Ajv, Redis, and RabbitMQ. It does not store deployment configuration or secrets, execute arbitrary expressions, or replace domain state machines, permissions, workflow routes, and algorithms.

Consumers receive resolved values together with definition, release, scope, and activation versions. PostgreSQL remains authoritative; Redis is a replaceable cache.

See [ADR-0013](../../../docs/08-架构决策/ADR-0013-版本化表单与业务配置中心.md) and the [module description](../../../docs/03-模块说明/业务配置模块.md).
