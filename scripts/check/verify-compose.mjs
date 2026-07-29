import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import { validatePreviousSessionKeyOverlay } from "./production-deployment-gates.mjs";
import { mergeComposeModels, validateEffectiveComposeSafety } from "./compose-safety.mjs";

const root = resolve(import.meta.dirname, "../..");
const parseCompose = async (path) => YAML.parse(await readFile(resolve(root, path), "utf8"), { merge: true });
const base = await parseCompose("deploy/compose/compose.base.yml");
const dev = await parseCompose("deploy/compose/compose.dev.yml");
const test = await parseCompose("deploy/compose/compose.test.yml");
const authTest = await parseCompose("deploy/compose/compose.auth-test.yml");
const rabbitmqIntegration = await parseCompose("deploy/compose/compose.rabbitmq-integration.yml");
const productionA = await parseCompose("deploy/compose/production/compose.host-a.yml");
const productionB = await parseCompose("deploy/compose/production/compose.host-b.yml");
const productionAPreviousKey = await parseCompose("deploy/compose/production/compose.host-a.bff-previous-key.yml");
const productionBPreviousKey = await parseCompose("deploy/compose/production/compose.host-b.bff-previous-key.yml");
const keycloakRealm = JSON.parse(await readFile(resolve(root, "deploy/keycloak/realm-dev.json"), "utf8"));
const keycloakEntrypoint = await readFile(resolve(root, "deploy/compose/entrypoints/keycloak-entrypoint.sh"), "utf8");
const secretBootstrap = await readFile(resolve(root, "scripts/bootstrap/compose-secrets.mjs"), "utf8");
const rabbitmqFixtureBootstrap = await readFile(resolve(root, "scripts/bootstrap/rabbitmq-integration-fixture.mjs"), "utf8");
const clientSecretRotation = await readFile(resolve(root, "scripts/bootstrap/rotate-keycloak-client-secret.mjs"), "utf8");
const productionNginx = await readFile(resolve(root, "deploy/nginx/nginx.production.conf.template"), "utf8");
const productionRedisEntrypoint = await readFile(resolve(root, "deploy/compose/production/redis-entrypoint.sh"), "utf8");
const productionRabbitEntrypoint = await readFile(resolve(root, "deploy/compose/production/rabbitmq-entrypoint.sh"), "utf8");
const productionKeycloakEntrypoint = await readFile(resolve(root, "deploy/compose/production/keycloak-entrypoint.sh"), "utf8");
const required = ["postgres", "redis", "rabbitmq", "keycloak", "flowable", "clamav", "nginx"];
const errors = [];

for (const [label, model, options] of [
  ["development", mergeComposeModels(base, dev), {}],
  ["test", mergeComposeModels(base, test), {}],
  ["authentication-test", mergeComposeModels(base, authTest), {}],
  ["rabbitmq-integration", mergeComposeModels(base, rabbitmqIntegration), {}],
  ["host-a", productionA, { production: true }],
  ["host-b", productionB, { production: true }],
  ["host-a-previous-key", mergeComposeModels(productionA, productionAPreviousKey), { production: true }],
  ["host-b-previous-key", mergeComposeModels(productionB, productionBPreviousKey), { production: true }],
]) errors.push(...validateEffectiveComposeSafety(model, label, options));

if (!base.services?.postgres?.secrets?.includes("postgres_migration_password")) {
  errors.push("PostgreSQL must receive a distinct migration credential file.");
}
if (!base.services?.keycloak?.secrets?.includes("pc_oidc_client_secret")) {
  errors.push("Keycloak must receive the PC OIDC Client Secret file.");
}
if (base.services?.keycloak?.volumes?.some((volume) => String(volume).includes("/opt/keycloak/data/import"))) {
  errors.push("Keycloak Realm templates must not be mounted directly into the import directory.");
}

const pcClient = keycloakRealm.clients?.find((client) => client.clientId === "ai-crm-pc-bff");
if (!pcClient || pcClient.secret !== "__AI_CRM_PC_CLIENT_SECRET__" ||
  pcClient.publicClient !== false || pcClient.standardFlowEnabled !== true ||
  pcClient.directAccessGrantsEnabled !== false || pcClient.serviceAccountsEnabled !== false ||
  !pcClient.protocolMappers?.some((mapper) => mapper.protocolMapper === "oidc-audience-mapper" &&
    mapper.config?.["included.custom.audience"] === "ai-crm-api" &&
    mapper.config?.["access.token.claim"] === "true" && mapper.config?.["id.token.claim"] === "false")) {
  errors.push("The development Realm must contain the confidential Authorization Code PC BFF Client template.");
}
if (!keycloakEntrypoint.includes("/run/secrets/pc_oidc_client_secret") ||
  !keycloakEntrypoint.includes("__AI_CRM_PC_CLIENT_SECRET__") ||
  !keycloakEntrypoint.includes('${#client_secret}') ||
  /export\s+[^\n]*CLIENT[^\n]*SECRET/iu.test(keycloakEntrypoint)) {
  errors.push("Keycloak must inject the PC Client Secret from a file without exporting it.");
}
if (!secretBootstrap.includes('"pc_oidc_client_secret"')) {
  errors.push("Development/test Secret bootstrap must create the PC OIDC Client Secret file.");
}
if (!clientSecretRotation.includes("/client-secret") ||
  !clientSecretRotation.includes("AI_CRM_PC_OIDC_CLIENT_SECRET_FILE") ||
  !clientSecretRotation.includes("AbortSignal.timeout") ||
  !clientSecretRotation.includes("fileSystem.rename(temporaryFile, config.clientSecretFile)") ||
  clientSecretRotation.includes("console.log(nextSecret)")) {
  errors.push("Local/test Keycloak Client Secret rotation must update Keycloak and atomically replace the file.");
}

for (const name of required) {
  const service = base.services?.[name];
  if (!service) {
    errors.push(`Missing service ${name}.`);
    continue;
  }
  if (!service.image || service.image.endsWith(":latest") || !service.image.includes(":")) errors.push(`${name} must use a fixed image tag.`);
  if (!service.healthcheck) errors.push(`${name} must define a healthcheck.`);
  if (!service.logging?.options?.["max-size"] || !service.logging?.options?.["max-file"]) errors.push(`${name} must rotate logs.`);
  if (!service.deploy?.resources?.limits?.memory || !service.deploy?.resources?.limits?.cpus) errors.push(`${name} must define resource limits.`);
  if (!service.stop_grace_period) errors.push(`${name} must define graceful stop behavior.`);
  if (service.ports) errors.push(`${name} must not publish ports in the base definition.`);
}

for (const [name, service] of Object.entries(dev.services ?? {})) {
  for (const port of service.ports ?? []) {
    if (!String(port).startsWith("127.0.0.1:")) errors.push(`${name} publishes a non-loopback development port.`);
  }
}
if (base.networks?.backend?.external) errors.push("The backend network must remain project-scoped.");
for (const [name, service] of Object.entries(test.services ?? {})) {
  if (service?.ports) errors.push(`${name} must not publish test ports.`);
}
for (const [name, service] of Object.entries(authTest.services ?? {})) {
  for (const port of service.ports ?? []) {
    if (!String(port).startsWith("127.0.0.1:")) errors.push(`${name} publishes a non-loopback authentication test port.`);
  }
}
const rabbitmqIntegrationService = rabbitmqIntegration.services?.rabbitmq;
if (rabbitmqIntegrationService?.image !== "rabbitmq:4.2.9-management" ||
  rabbitmqIntegrationService?.ports?.length !== 1 ||
  !String(rabbitmqIntegrationService.ports[0]).startsWith("127.0.0.1:${AI_CRM_TEST_RABBITMQ_TLS_PORT:?") ||
  !rabbitmqIntegrationService?.healthcheck ||
  !rabbitmqIntegrationService?.stop_grace_period ||
  !rabbitmqIntegrationService?.deploy?.resources?.limits?.memory ||
  !rabbitmqIntegrationService?.logging?.options?.["max-size"]) {
  errors.push("RabbitMQ integration Compose must pin 4.2.9, publish only an explicit loopback TLS port, and retain lifecycle limits.");
}
const rabbitmqIntegrationMounts = rabbitmqIntegrationService?.volumes?.map(String) ?? [];
if (rabbitmqIntegrationMounts.length !== 5 ||
  rabbitmqIntegrationMounts.some((mount) => !mount.endsWith(":ro")) ||
  rabbitmqIntegrationMounts.some((mount) => /(?:ca\.key|untrusted|_password|_username|\/vhost)(?::|$)/u.test(mount))) {
  errors.push("RabbitMQ integration container must receive only its five required read-only TLS/configuration files.");
}
for (const requiredText of [
  '"listeners.tcp = none"',
  '"listeners.ssl.default = 5671"',
  '"ssl_options.verify = verify_peer"',
  'publisher: { name: "ai_crm_integration_publisher"',
  'consumer: { name: "ai_crm_integration_consumer"',
  'configure: "^$", write: "^ai\\\\.crm\\\\.events$", read: "^$"',
  'configure: "^$", write: "^$", read: "^ai\\\\.crm\\\\.integration$"',
]) {
  if (!rabbitmqFixtureBootstrap.includes(requiredText)) errors.push(`RabbitMQ integration fixture is missing required fail-closed boundary: ${requiredText}`);
}

const productionDefinitions = [
  ["host-a", productionA, "ai-crm-prod-a", ["api", "clamav", "edge", "flowable", "keycloak", "postgres", "rabbitmq", "redis"]],
  ["host-b", productionB, "ai-crm-prod-b", ["api", "edge", "worker"]],
];
for (const [host, definition, project, expectedServices] of productionDefinitions) {
  if (definition.name !== project) errors.push(`${host} must use the independent Compose project ${project}.`);
  const actualServices = Object.keys(definition.services ?? {}).sort();
  if (actualServices.length !== expectedServices.length || actualServices.some((name, index) => name !== expectedServices[index])) {
    errors.push(`${host} has an unexpected production service placement.`);
  }
  for (const [name, service] of Object.entries(definition.services ?? {})) {
    if (typeof service.image !== "string" || !/^\$\{AI_CRM_[A-Z0-9_]+_IMAGE:\?[^}]+\}$/u.test(service.image)) {
      errors.push(`${host}/${name} must receive its reviewed immutable image reference explicitly.`);
    }
    if (!service.healthcheck) errors.push(`${host}/${name} must define a healthcheck.`);
    if (!service.logging?.options?.["max-size"] || !service.logging?.options?.["max-file"]) errors.push(`${host}/${name} must rotate logs.`);
    if (!service.deploy?.resources?.limits?.memory || !service.deploy?.resources?.limits?.cpus) errors.push(`${host}/${name} must require resource limits.`);
    if (!service.stop_grace_period) errors.push(`${host}/${name} must define graceful stop behavior.`);
    if (service.privileged === true || service.volumes?.some((volume) => String(volume).includes("/var/run/docker.sock"))) {
      errors.push(`${host}/${name} must not be privileged or mount the Docker Socket.`);
    }
    if (!service.security_opt?.includes("no-new-privileges:true") || !service.cap_drop?.includes("ALL")) {
      errors.push(`${host}/${name} must drop capabilities and prevent privilege escalation.`);
    }
    for (const port of service.ports ?? []) {
      const value = String(port);
      if (name === "edge") {
        if (value !== "80:8080" && value !== "443:8443") errors.push(`${host}/edge has an unexpected public port.`);
      } else if (!value.startsWith("${AI_CRM_PRIVATE_BIND_ADDRESS:?")) {
        errors.push(`${host}/${name} must bind published ports to the reviewed private address.`);
      }
    }
    if ((service.secrets?.length ?? 0) > 0 && !service.group_add?.includes("${AI_CRM_SECRET_GID:?secret reader gid is required}")) {
      errors.push(`${host}/${name} must receive only the approved supplementary Secret-reader group.`);
    }
  }
  for (const [name, secret] of Object.entries(definition.secrets ?? {})) {
    if (typeof secret?.file !== "string" || !secret.file.startsWith("${AI_CRM_SECRET_ROOT:?")) {
      errors.push(`${host} Secret ${name} must be a target-host file reference.`);
    }
  }
  const productionText = JSON.stringify(definition);
  if (/\blatest\b/iu.test(productionText) || /(?:^|[/\\])\.env(?:$|["'])/iu.test(productionText)) {
    errors.push(`${host} must not use latest images or a production .env file.`);
  }
}
for (const [host, definition] of [["host-a", productionA], ["host-b", productionB]]) {
  for (const name of ["api", "edge", ...(host === "host-b" ? ["worker"] : [])]) {
    const service = definition.services?.[name];
    if (service?.read_only !== true || typeof service.user !== "string") {
      errors.push(`${host}/${name} application container must be read-only and non-root.`);
    }
  }
  const api = definition.services?.api;
  if (!api?.secrets?.includes("api_postgres_url") ||
    !api.secrets.includes("api_cos_secret_id") ||
    !api.secrets.includes("api_cos_secret_key") ||
    api.environment?.AI_CRM_POSTGRES_URL_FILE !== "/run/secrets/api_postgres_url" ||
    api.environment?.AI_CRM_COS_SECRET_ID_FILE !== "/run/secrets/api_cos_secret_id" ||
    api.environment?.AI_CRM_COS_SECRET_KEY_FILE !== "/run/secrets/api_cos_secret_key" ||
    typeof api.environment?.AI_CRM_COS_BUCKET !== "string" ||
    typeof api.environment?.AI_CRM_COS_REGION !== "string" ||
    api.environment?.AI_CRM_MIGRATIONS_ROOT !== "/app" ||
    typeof api.environment?.AI_CRM_API_SCHEMA_VERSION !== "string" ||
    typeof api.environment?.AI_CRM_KEYCLOAK_JWKS_URI !== "string" ||
    typeof api.environment?.AI_CRM_API_STARTUP_TIMEOUT_MS !== "string" ||
    typeof api.environment?.AI_CRM_API_SHUTDOWN_TIMEOUT_MS !== "string") {
    errors.push(`${host}/api must receive the reviewed production database, migration, identity and lifecycle configuration.`);
  }
  const edgeTmpfs = definition.services?.edge?.tmpfs?.map(String) ?? [];
  for (const directory of ["/etc/nginx/conf.d", "/var/cache/nginx", "/var/run", "/tmp"]) {
    const mount = edgeTmpfs.find((value) => value.startsWith(`${directory}:`));
    if (!mount || !mount.includes("uid=${AI_CRM_EDGE_UID:?") || !mount.includes("gid=${AI_CRM_EDGE_GID:?") || !mount.includes("mode=0750")) {
      errors.push(`${host}/edge must provide a UID/GID-scoped writable tmpfs for ${directory}.`);
    }
  }
}
for (const error of validatePreviousSessionKeyOverlay(productionA, productionAPreviousKey, "ai-crm-prod-a")) errors.push(`host-a: ${error}`);
for (const error of validatePreviousSessionKeyOverlay(productionB, productionBPreviousKey, "ai-crm-prod-b")) errors.push(`host-b: ${error}`);
const worker = productionB.services?.worker;
if (worker?.environment?.AI_CRM_WORKER_DRAIN_TIMEOUT_SECONDS !== "${AI_CRM_WORKER_DRAIN_TIMEOUT_SECONDS:?required}" ||
  worker?.stop_grace_period !== "${AI_CRM_WORKER_STOP_GRACE_PERIOD:?required}") {
  errors.push("host-b/worker must require explicit drain seconds and stop grace duration for rendered numeric verification.");
}
for (const name of ["worker_postgres_url", "rabbitmq_ca_certificate", "rabbitmq_publisher_username", "rabbitmq_publisher_password", "rabbitmq_consumer_username", "rabbitmq_consumer_password"]) {
  if (!worker?.secrets?.includes(name)) errors.push(`host-b/worker must mount ${name} as an individual Secret.`);
}
for (const name of ["AI_CRM_WORKER_OUTBOX_BATCH_SIZE", "AI_CRM_WORKER_OUTBOX_CLAIM_LEASE_SECONDS", "AI_CRM_WORKER_OUTBOX_MAX_ATTEMPTS", "AI_CRM_WORKER_OUTBOX_BACKOFF_SECONDS", "AI_CRM_WORKER_OUTBOX_INTERVAL_MS"]) {
  if (typeof worker?.environment?.[name] !== "string" || !worker.environment[name].startsWith(`\${${name}:?`)) {
    errors.push(`host-b/worker must require reviewed release input ${name}.`);
  }
}
if (worker?.environment?.AI_CRM_WORKER_TASK_PROJECTION_CONSUMER_ENABLED !== "${AI_CRM_WORKER_TASK_PROJECTION_CONSUMER_ENABLED:?explicit reviewed activation is required}" ||
  worker?.environment?.AI_CRM_RABBIT_TLS !== "true" ||
  worker?.environment?.AI_CRM_RABBIT_PORT !== "5671") {
  errors.push("host-b/worker must require explicit reviewed Task projection activation and use AMQPS.");
}
if (!productionNginx.includes("access_log /dev/stdout safe_technical") ||
  /log_format[^;]*\$(?:request(?:\s|['"])|request_uri|args|remote_addr)/u.test(productionNginx)) {
  errors.push("Production Nginx access logs must exclude URL/query/IP content and use bounded technical fields.");
}
if (!productionRedisEntrypoint.includes('${#password}') || !productionRedisEntrypoint.includes("*[!A-Za-z0-9_-]*") || productionRedisEntrypoint.includes("console.log")) {
  errors.push("Redis production entrypoint must validate its Secret without emitting it.");
}
for (const requiredText of ["listeners.tcp = none", "listeners.ssl.default = 5671", "ssl_options.verify = verify_peer", "rabbitmq_publisher_username", "rabbitmq_consumer_username", '"configure":"^ai-crm\\\\.platform']) {
  if (!productionRabbitEntrypoint.includes(requiredText)) errors.push(`RabbitMQ production entrypoint is missing the reviewed TLS/least-privilege boundary: ${requiredText}`);
}
if (!productionRabbitEntrypoint.includes('"write":"^(ai-crm\\\\.platform\\\\.(events|retry|dead-letter)') ||
  !productionRabbitEntrypoint.includes('"read":"^(ai-crm\\\\.platform\\\\.(events|retry|dead-letter)') ||
  !productionRabbitEntrypoint.includes('task-center\\\\.projection\\\\.v1)$"')) {
  errors.push("RabbitMQ production consumer permissions must cover the reviewed declarations, bindings, retry publishing and main queue consumption.");
}
if (productionKeycloakEntrypoint.includes("start-dev") || productionKeycloakEntrypoint.includes("realm-dev") ||
  !productionKeycloakEntrypoint.includes("/run/secrets/postgres_keycloak_password")) {
  errors.push("Production Keycloak must not reuse the development Realm/import mode and must read its database credential from a file.");
}

const serialized = JSON.stringify(base);
if (/"[^"\n]*(?:PASSWORD|SECRET|TOKEN)"\s*:\s*"(?!\/run\/secrets\/)[^"$]/i.test(serialized)) {
  errors.push("Compose contains a literal credential-like environment value.");
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log("Compose definitions satisfy the INF-01 static safety baseline.");
