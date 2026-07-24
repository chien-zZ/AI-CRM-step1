import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const requiredScripts = ["build", "lint", "typecheck", "test", "contracts:check"];
const missingScripts = requiredScripts.filter((script) => typeof manifest.scripts?.[script] !== "string");

await access(resolve("src/index.ts"));

if (missingScripts.length > 0) {
  console.error(`${manifest.name} is missing scripts: ${missingScripts.join(", ")}`);
  process.exit(1);
}

if (manifest.type !== "module" || manifest.exports?.["."] !== "./dist/index.js") {
  console.error(`${manifest.name} must expose only its compiled public entry point.`);
  process.exit(1);
}
