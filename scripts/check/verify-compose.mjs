import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";

const root = resolve(import.meta.dirname, "../..");
const parseCompose = async (path) => YAML.parse(await readFile(resolve(root, path), "utf8"), { merge: true });
const base = await parseCompose("deploy/compose/compose.base.yml");
const dev = await parseCompose("deploy/compose/compose.dev.yml");
const test = await parseCompose("deploy/compose/compose.test.yml");
const authTest = await parseCompose("deploy/compose/compose.auth-test.yml");
const keycloakRealm = JSON.parse(await readFile(resolve(root, "deploy/keycloak/realm-dev.json"), "utf8"));
const keycloakEntrypoint = await readFile(resolve(root, "deploy/compose/entrypoints/keycloak-entrypoint.sh"), "utf8");
const secretBootstrap = await readFile(resolve(root, "scripts/bootstrap/compose-secrets.mjs"), "utf8");
const clientSecretRotation = await readFile(resolve(root, "scripts/bootstrap/rotate-keycloak-client-secret.mjs"), "utf8");
const required = ["postgres", "redis", "rabbitmq", "keycloak", "flowable", "clamav", "nginx"];
const errors = [];

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

const serialized = JSON.stringify(base);
if (/"[^"\n]*(?:PASSWORD|SECRET|TOKEN)"\s*:\s*"(?!\/run\/secrets\/)[^"$]/i.test(serialized)) {
  errors.push("Compose contains a literal credential-like environment value.");
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log("Compose definitions satisfy the INF-01 static safety baseline.");
