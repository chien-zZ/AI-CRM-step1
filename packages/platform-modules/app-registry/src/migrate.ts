import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runMigrations } from "@ai-crm/database";
const secretPath = process.env.DATABASE_MIGRATION_URL_FILE;
if (!secretPath) throw new Error("DATABASE_MIGRATION_URL_FILE is required.");
const connectionString = (await readFile(resolve(secretPath), "utf8")).toString().trim();
if (connectionString.length === 0) throw new Error("DATABASE_MIGRATION_URL_FILE resolved to an empty Secret.");
await runMigrations(connectionString, resolve(import.meta.dirname, "../migrations"));
