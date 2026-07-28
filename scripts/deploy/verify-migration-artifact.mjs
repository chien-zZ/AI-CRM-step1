import { resolve } from "node:path";
import { verifyEmbeddedMigrationArtifact } from "./migration-artifact.mjs";

const [artifactRootArgument, expectedDigest] = process.argv.slice(2);
if (!artifactRootArgument || !expectedDigest) {
  console.error("Usage: node scripts/deploy/verify-migration-artifact.mjs <unpacked-artifact-root> <approved-sha256>");
  process.exit(2);
}

try {
  const artifactRoot = resolve(artifactRootArgument);
  const result = await verifyEmbeddedMigrationArtifact(artifactRoot, expectedDigest);
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(error);
    process.exit(1);
  }
  console.log(`Migration artifact matches approved manifest ${result.manifestDigest}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Migration artifact verification failed.");
  process.exit(1);
}
