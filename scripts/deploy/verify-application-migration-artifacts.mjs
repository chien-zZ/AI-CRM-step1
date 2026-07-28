import { resolve } from "node:path";
import { verifyApplicationMigrationArtifacts } from "./migration-artifact.mjs";

const [apiRootArgument, workerRootArgument, expectedDigest] = process.argv.slice(2);
if (!apiRootArgument || !workerRootArgument || !expectedDigest) {
  console.error("Usage: node scripts/deploy/verify-application-migration-artifacts.mjs <unpacked-api-root> <unpacked-worker-root> <approved-sha256>");
  process.exit(2);
}

let failed = false;
const results = await verifyApplicationMigrationArtifacts(resolve(apiRootArgument), resolve(workerRootArgument), expectedDigest);
for (const [name, result] of Object.entries(results)) {
  if (result.errors.length > 0) {
    failed = true;
    for (const error of result.errors) console.error(`${name}: ${error}`);
  } else {
    console.log(`${name} migration artifact matches approved manifest ${result.manifestDigest}.`);
  }
}
if (failed) process.exit(1);
