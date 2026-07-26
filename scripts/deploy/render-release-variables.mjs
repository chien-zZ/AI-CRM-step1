import { resolve } from "node:path";
import { readAndValidateReleaseManifest, renderComposeVariables } from "./release-manifest.mjs";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/deploy/render-release-variables.mjs <release-manifest.json>");
  process.exit(2);
}

const result = await readAndValidateReleaseManifest(resolve(path));
if (result.errors.length > 0) {
  for (const error of result.errors) console.error(error);
  process.exit(1);
}
process.stdout.write(renderComposeVariables(result.manifest));
