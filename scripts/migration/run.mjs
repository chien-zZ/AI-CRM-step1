import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runMigrations } from "../../packages/database/dist/index.js";

const secretPath = process.env.DATABASE_MIGRATION_URL_FILE;
if (!secretPath) {
  console.error("DATABASE_MIGRATION_URL_FILE is required.");
  process.exit(1);
}

const connectionString = (await readFile(resolve(secretPath), "utf8")).trim();
if (!connectionString) {
  console.error("DATABASE_MIGRATION_URL_FILE resolved to an empty Secret.");
  process.exit(1);
}

await runMigrations(connectionString, resolve("packages/database/migrations"));
console.log("Database migrations are current.");
