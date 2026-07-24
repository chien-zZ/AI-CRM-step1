import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";

const root = resolve(import.meta.dirname, "../..");
const parseCompose = async (path) => YAML.parse(await readFile(resolve(root, path), "utf8"), { merge: true });
const base = await parseCompose("deploy/compose/compose.base.yml");
const dev = await parseCompose("deploy/compose/compose.dev.yml");
const test = await parseCompose("deploy/compose/compose.test.yml");
const required = ["postgres", "redis", "rabbitmq", "keycloak", "flowable", "clamav", "nginx"];
const errors = [];

if (!base.services?.postgres?.secrets?.includes("postgres_migration_password")) {
  errors.push("PostgreSQL must receive a distinct migration credential file.");
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

const serialized = JSON.stringify(base);
if (/"[^"\n]*(?:PASSWORD|SECRET|TOKEN)"\s*:\s*"(?!\/run\/secrets\/)[^"$]/i.test(serialized)) {
  errors.push("Compose contains a literal credential-like environment value.");
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log("Compose definitions satisfy the INF-01 static safety baseline.");
