import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SAFE_PATH = /^packages\/(?:database|platform-modules\/[A-Za-z0-9._-]+)\/migrations(?:\/[A-Za-z0-9._-]+)*$/u;

export const MIGRATION_MANIFEST_RELATIVE_PATH = "ai-crm-migrations.manifest.json";

const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const portable = (value) => value.split(sep).join("/");

const requireDirectory = async (path, label, optional = false) => {
  const status = await lstat(path).catch(() => undefined);
  if (!status) {
    if (optional) return false;
    throw new Error(`Migration artifact directory is missing: ${label}.`);
  }
  if (status.isSymbolicLink()) throw new Error(`Migration artifact must not contain symbolic links: ${label}.`);
  if (!status.isDirectory()) throw new Error(`Migration artifact path must be a directory: ${label}.`);
  return true;
};

const walkFiles = async (root, directory, files) => {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Migration artifact must not contain symbolic links: ${portable(relative(root, path))}.`);
    if (entry.isDirectory()) await walkFiles(root, path, files);
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Migration artifact contains an unsupported entry: ${portable(relative(root, path))}.`);
  }
};

export const serializeMigrationManifest = (manifest) => `${JSON.stringify(manifest, null, 2)}\n`;
export const migrationManifestDigest = (manifest) => digest(serializeMigrationManifest(manifest));

export const discoverMigrationRoots = async (artifactRoot) => {
  const roots = [];
  await requireDirectory(artifactRoot, ".");
  await requireDirectory(resolve(artifactRoot, "packages"), "packages");

  const databaseModuleRoot = resolve(artifactRoot, "packages/database");
  const databaseRoot = resolve(artifactRoot, "packages/database/migrations");
  if (await requireDirectory(databaseModuleRoot, "packages/database", true)) {
    if (await requireDirectory(databaseRoot, "packages/database/migrations", true)) roots.push("packages/database/migrations");
  }

  const modulesRoot = resolve(artifactRoot, "packages/platform-modules");
  if (!await requireDirectory(modulesRoot, "packages/platform-modules", true)) return roots;
  for (const entry of await readdir(modulesRoot, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Migration artifact must not contain symbolic links: packages/platform-modules/${entry.name}.`);
    if (!entry.isDirectory()) continue;
    const migrationRoot = resolve(modulesRoot, entry.name, "migrations");
    if (await requireDirectory(migrationRoot, `packages/platform-modules/${entry.name}/migrations`, true)) {
      roots.push(`packages/platform-modules/${entry.name}/migrations`);
    }
  }
  return roots.sort((left, right) => left.localeCompare(right, "en"));
};

export const buildMigrationManifest = async (artifactRoot) => {
  const migrationRoots = await discoverMigrationRoots(artifactRoot);
  if (migrationRoots.length === 0) throw new Error("No reviewed migration directories were found.");
  const paths = [];
  for (const migrationRoot of migrationRoots) await walkFiles(artifactRoot, resolve(artifactRoot, migrationRoot), paths);
  const files = [];
  for (const path of paths.sort((left, right) => portable(relative(artifactRoot, left)).localeCompare(portable(relative(artifactRoot, right)), "en"))) {
    const content = await readFile(path);
    files.push({ path: portable(relative(artifactRoot, path)), size: content.byteLength, sha256: digest(content) });
  }
  if (files.length === 0) throw new Error("Reviewed migration directories contain no files.");
  return { schemaVersion: 1, artifact: "ai-crm-reviewed-migrations", migrationRoots, files };
};

export const validateMigrationManifest = (manifest) => {
  const errors = [];
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) return ["Migration manifest must be an object."];
  const keys = Object.keys(manifest).sort();
  const expectedKeys = ["artifact", "files", "migrationRoots", "schemaVersion"];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    errors.push(`Migration manifest must contain exactly: ${expectedKeys.join(", ")}.`);
  }
  if (manifest.schemaVersion !== 1) errors.push("Migration manifest schemaVersion must be 1.");
  if (manifest.artifact !== "ai-crm-reviewed-migrations") errors.push("Migration manifest artifact type is invalid.");
  if (!Array.isArray(manifest.migrationRoots) || manifest.migrationRoots.length === 0) {
    errors.push("Migration manifest must contain migrationRoots.");
  } else {
    const sorted = [...manifest.migrationRoots].sort((left, right) => String(left).localeCompare(String(right), "en"));
    if (manifest.migrationRoots.some((path) => typeof path !== "string" || !SAFE_PATH.test(path)) ||
      new Set(manifest.migrationRoots).size !== manifest.migrationRoots.length ||
      sorted.some((path, index) => path !== manifest.migrationRoots[index])) {
      errors.push("Migration manifest roots must be unique, sorted, safe migration paths.");
    }
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    errors.push("Migration manifest must contain files.");
  } else {
    const seen = new Set();
    let previous = "";
    for (const [index, file] of manifest.files.entries()) {
      const path = `files[${index}]`;
      if (file === null || typeof file !== "object" || Array.isArray(file) ||
        Object.keys(file).sort().join(",") !== "path,sha256,size") {
        errors.push(`${path} must contain exactly path, sha256 and size.`);
        continue;
      }
      const safeFilePath = typeof file.path === "string" && SAFE_PATH.test(file.path) && !file.path.includes("..") && !seen.has(file.path) && file.path > previous;
      if (!safeFilePath) {
        errors.push(`${path}.path must be a unique, sorted, safe migration file path.`);
      }
      if (typeof file.path === "string") {
        seen.add(file.path);
        previous = file.path;
      }
      if (!Number.isSafeInteger(file.size) || file.size < 0) errors.push(`${path}.size must be a non-negative safe integer.`);
      if (typeof file.sha256 !== "string" || !SHA256.test(file.sha256)) errors.push(`${path}.sha256 must be a sha256 digest.`);
      if (typeof file.path === "string" && Array.isArray(manifest.migrationRoots) && !manifest.migrationRoots.some((root) => file.path.startsWith(`${root}/`))) {
        errors.push(`${path}.path is not inside a declared migration root.`);
      }
    }
  }
  return [...new Set(errors)];
};

export const verifyMigrationArtifact = async (artifactRoot, manifest, expectedDigest) => {
  const errors = validateMigrationManifest(manifest);
  const actualManifestDigest = migrationManifestDigest(manifest);
  if (typeof expectedDigest !== "string" || !SHA256.test(expectedDigest)) errors.push("Expected migration manifest digest must be sha256.");
  else if (actualManifestDigest !== expectedDigest) errors.push("Migration manifest digest does not match the approved release digest.");
  if (errors.length > 0) return { errors: [...new Set(errors)], manifestDigest: actualManifestDigest };

  let actual;
  try {
    actual = await buildMigrationManifest(artifactRoot);
  } catch (error) {
    return { errors: [error instanceof Error ? error.message : "Migration artifact could not be read."], manifestDigest: actualManifestDigest };
  }
  const expectedRoots = JSON.stringify(manifest.migrationRoots);
  if (JSON.stringify(actual.migrationRoots) !== expectedRoots) errors.push("Migration artifact directory set does not match the approved manifest.");
  const approvedByPath = new Map(manifest.files.map((file) => [file.path, file]));
  const actualByPath = new Map(actual.files.map((file) => [file.path, file]));
  for (const file of manifest.files) {
    const candidate = actualByPath.get(file.path);
    if (!candidate) errors.push(`Migration artifact is missing approved file: ${file.path}.`);
    else if (candidate.size !== file.size || candidate.sha256 !== file.sha256) errors.push(`Migration artifact file does not match approved digest: ${file.path}.`);
  }
  for (const file of actual.files) {
    if (!approvedByPath.has(file.path)) errors.push(`Migration artifact contains an unapproved file: ${file.path}.`);
  }
  return { errors: [...new Set(errors)], manifestDigest: actualManifestDigest };
};

export const verifyEmbeddedMigrationArtifact = async (artifactRoot, expectedDigest) => {
  let manifest;
  try {
    const manifestPath = resolve(artifactRoot, MIGRATION_MANIFEST_RELATIVE_PATH);
    const status = await lstat(manifestPath);
    if (status.isSymbolicLink() || !status.isFile()) throw new Error("embedded manifest must be a regular file");
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    return {
      errors: [`Embedded migration manifest could not be read: ${error instanceof Error ? error.message : "unknown error"}.`],
    };
  }
  return verifyMigrationArtifact(artifactRoot, manifest, expectedDigest);
};

export const verifyApplicationMigrationArtifacts = async (apiRoot, workerRoot, expectedDigest) => {
  const results = {};
  for (const [name, root] of [["api", apiRoot], ["worker", workerRoot]]) {
    results[name] = await verifyEmbeddedMigrationArtifact(root, expectedDigest);
  }
  return results;
};
