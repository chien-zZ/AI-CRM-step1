import { sanitizeApplicationArtifact } from "./application-artifact-hygiene.mjs";

const [artifactRoot] = process.argv.slice(2);
if (!artifactRoot) {
  console.error("Usage: node scripts/deploy/sanitize-application-artifact.mjs <application-artifact-root>");
  process.exit(1);
}

try {
  const result = await sanitizeApplicationArtifact(artifactRoot);
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log(`Sanitized ${result.removed.length} forbidden paths across the application and ${result.workspaceRoots.length} @ai-crm runtime packages.`);
  }
} catch (error) {
  const category = error instanceof Error && /^artifact_[a-z_]+$/u.test(error.message) ? error.message : "artifact_hygiene_failed";
  console.error(category);
  process.exitCode = 1;
}
