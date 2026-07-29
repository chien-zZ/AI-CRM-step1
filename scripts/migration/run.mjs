import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
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

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const directories = [resolve(repositoryRoot, "packages/database/migrations")];
for (const entry of await readdir(resolve(repositoryRoot, "packages/platform-modules"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = resolve(repositoryRoot, "packages/platform-modules", entry.name, "migrations");
  try { if ((await readdir(directory)).some((name) => name.endsWith(".sql"))) directories.push(directory); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
await runMigrations(connectionString, directories);
console.log("Database migrations are current.");
