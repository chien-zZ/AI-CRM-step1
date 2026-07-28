import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";

const urlFile = process.env.TEST_DATABASE_MISSING_ROLE_URL_FILE;
const timeoutMs = Number(process.env.AI_CRM_DATABASE_READY_TIMEOUT_MS ?? "30000");

if (!urlFile || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
  console.error("PostgreSQL SQL readiness configuration is invalid.");
  process.exit(1);
}

let connectionString;
try {
  connectionString = (await readFile(resolve(urlFile), "utf8")).trim();
} catch {
  console.error("PostgreSQL SQL readiness URL file is unavailable.");
  process.exit(1);
}
if (!connectionString) {
  console.error("PostgreSQL SQL readiness URL file is empty.");
  process.exit(1);
}

const deadline = Date.now() + timeoutMs;
while (Date.now() < deadline) {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 1_000,
    max: 1,
    query_timeout: 1_000,
    statement_timeout: 1_000,
  });
  try {
    const result = await pool.query("select 1::integer as ready");
    if (result.rowCount === 1 && result.rows[0]?.ready === 1) {
      await pool.end();
      console.log("PostgreSQL SQL readiness probe passed.");
      process.exit(0);
    }
  } catch {
    // Readiness failures are intentionally reduced to a stable final error without connection details.
  }
  await pool.end().catch(() => undefined);
  await delay(250);
}

console.error("PostgreSQL SQL readiness deadline exceeded.");
process.exit(1);
