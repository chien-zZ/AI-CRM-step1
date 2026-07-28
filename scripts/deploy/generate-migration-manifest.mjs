import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildMigrationManifest, migrationManifestDigest, serializeMigrationManifest } from "./migration-artifact.mjs";

const [artifactRootArgument, outputArgument] = process.argv.slice(2);
if (!artifactRootArgument || !outputArgument) {
  console.error("Usage: node scripts/deploy/generate-migration-manifest.mjs <reviewed-repository-root> <output-manifest.json>");
  process.exit(2);
}

try {
  const manifest = await buildMigrationManifest(resolve(artifactRootArgument));
  await writeFile(resolve(outputArgument), serializeMigrationManifest(manifest), { flag: "wx" });
  console.log(`Generated migration manifest ${migrationManifestDigest(manifest)} with ${manifest.files.length} reviewed files.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Migration manifest generation failed.");
  process.exit(1);
}
