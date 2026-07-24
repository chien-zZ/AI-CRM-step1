# Configuration

Typed deployment-time configuration loading, startup validation, and environment conventions. It owns service addresses, connection settings, timeouts, feature wiring, and secret references, but not business dictionaries, runtime business parameters, or form definitions.

Production Secrets are read through typed `*_FILE` references from per-service read-only files, normally mounted by Docker Compose under `/run/secrets/`. This package validates presence, format, and compatibility without logging values and fails closed when a required Secret is unavailable. It does not implement a vault, persist Secret values, or expose them to domain modules and clients.

Non-secret deployment settings may use validated environment variables. Production Secret values must not appear in environment values, Compose YAML, Git, the business-configuration database, logs, Sentry, or frontend artifacts. See [ADR-0013](../../docs/08-架构决策/ADR-0013-版本化表单与业务配置中心.md) and [ADR-0023](../../docs/08-架构决策/ADR-0023-文件式Secret与两台主机安全基线.md).

## Public API

- `configuration.*` declares required, optional, bounded, enumerated, URL, and Secret-file fields.
- `loadConfiguration` validates all fields at startup, rejects duplicate variables, and returns a frozen typed object.
- `readSecretFile` is the low-level `*_FILE` loader. Prefer `configuration.secretFile` in applications.
- `ConfigurationError` exposes only a stable `code` and variable name. It never includes the rejected value, Secret path, or filesystem cause.

URL fields reject credentials, query strings, and fragments. Production (`NODE_ENV=production`) requires Secret files to be regular, non-symlink files with mode `0400` or `0440`. Local tests may inject a `SecretFileSystem`; this is a test boundary, not a production storage provider.

```ts
import { configuration, loadConfiguration } from "@ai-crm/config";

const settings = await loadConfiguration({
  environment: configuration.enumeration("AI_CRM_ENVIRONMENT", ["development", "test", "production"]),
  service: configuration.string("AI_CRM_SERVICE", { maxLength: 64 }),
  sessionKey: configuration.secretFile("AI_CRM_SESSION_KEY_FILE"),
});
```

Application-owned schemas must keep Secret values private to the application composition root. Domain modules and clients receive neither the values nor the `*_FILE` paths.
