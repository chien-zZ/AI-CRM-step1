import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import { validateRenderedWorkerDrain } from "./production-deployment-gates.mjs";

const [renderedComposeArgument] = process.argv.slice(2);
if (!renderedComposeArgument) {
  console.error("Usage: node scripts/check/verify-worker-drain.mjs <rendered-host-b-compose.yml>");
  process.exit(2);
}

try {
  let renderedCompose;
  if (renderedComposeArgument === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    renderedCompose = Buffer.concat(chunks).toString("utf8");
  } else {
    renderedCompose = await readFile(resolve(renderedComposeArgument), "utf8");
  }
  const compose = YAML.parse(renderedCompose);
  const errors = validateRenderedWorkerDrain(compose);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log("Rendered Worker drain timeout is strictly less than Compose stop_grace_period.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Rendered Worker Compose could not be verified.");
  process.exit(1);
}
