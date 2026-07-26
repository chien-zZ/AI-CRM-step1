import { resolve } from "node:path";
import { readAndValidateReleaseManifest } from "./release-manifest.mjs";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/deploy/verify-release.mjs <release-manifest.json>");
  process.exit(2);
}

const result = await readAndValidateReleaseManifest(resolve(path));
if (result.errors.length > 0) {
  for (const error of result.errors) console.error(error);
  process.exit(1);
}

console.log(`Release manifest ${result.manifest.releaseId} has valid OPS-01 structure and evidence bindings; referenced evidence still requires trusted-source verification.`);
