import { readFileSync, statSync } from "node:fs";

const filePath = process.env.AI_CRM_WORKER_HEALTH_FILE ?? "/tmp/ai-crm-worker-ready.json";
const maximumAgeSeconds = Number(process.env.AI_CRM_WORKER_HEALTH_MAX_AGE_SECONDS ?? "45");

try {
  if (!Number.isSafeInteger(maximumAgeSeconds) || maximumAgeSeconds < 5 || maximumAgeSeconds > 300) process.exit(1);
  const stat = statSync(filePath);
  if (!stat.isFile() || stat.size < 1 || stat.size > 256) process.exit(1);
  const value = JSON.parse(readFileSync(filePath, "utf8"));
  const keys = value && typeof value === "object" ? Object.keys(value).sort() : [];
  const age = Date.now() - value.updatedAt;
  const valid = keys.length === 2 && keys[0] === "status" && keys[1] === "updatedAt" && value.status === "ok" &&
    Number.isSafeInteger(value.updatedAt) && age >= -5_000 && age <= maximumAgeSeconds * 1_000;
  process.exit(valid ? 0 : 1);
} catch {
  process.exit(1);
}
