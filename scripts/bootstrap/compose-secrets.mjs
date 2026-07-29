import { randomBytes } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

const environment = process.argv[2];
if (!['dev', 'test'].includes(environment)) {
  console.error("Usage: node scripts/bootstrap/compose-secrets.mjs <dev|test>");
  process.exit(1);
}

const override = process.env.AI_CRM_COMPOSE_SECRET_DIR;
if (override && !isAbsolute(override)) {
  console.error("AI_CRM_COMPOSE_SECRET_DIR must be an absolute path.");
  process.exit(1);
}
const directory = override ?? resolve("deploy/compose/.runtime", environment);
const names = [
  "postgres_admin_password",
  "postgres_migration_password",
  "postgres_app_password",
  "postgres_worker_password",
  "postgres_keycloak_password",
  "postgres_flowable_password",
  "keycloak_bootstrap_password",
  "pc_oidc_client_secret",
  "flowable_admin_password",
  "rabbitmq_password",
  "redis_password",
];

await mkdir(directory, { recursive: true });
for (const name of names) {
  try {
    const file = await open(resolve(directory, name), "wx", 0o600);
    await file.writeFile(`${randomBytes(32).toString("base64url")}\n`);
    await file.close();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
}
if (process.env.AI_CRM_CREATE_TEST_MIGRATION_URL === "1") {
  const port = process.env.AI_CRM_TEST_POSTGRES_PORT;
  if (!port?.match(/^\d{4,5}$/) || Number(port) > 65_535) {
    console.error("AI_CRM_TEST_POSTGRES_PORT must be a valid explicit test port.");
    process.exit(1);
  }
  const password = readFile(resolve(directory, "postgres_migration_password"), "utf8");
  const file = await open(resolve(directory, "migration_url"), "wx", 0o600).catch((error) => {
    if (error?.code === "EEXIST") return undefined;
    throw error;
  });
  if (file) {
    await file.writeFile(`postgresql://ai_crm_migration:${(await password).trim()}@127.0.0.1:${port}/ai_crm\n`);
    await file.close();
  }
}
console.log(`Runtime Secret files are present for ${environment}; existing files were preserved.`);
