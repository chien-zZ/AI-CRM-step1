import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildMigrationManifest,
  MIGRATION_MANIFEST_RELATIVE_PATH,
  migrationManifestDigest,
  serializeMigrationManifest,
  validateMigrationManifest,
  verifyApplicationMigrationArtifacts,
  verifyEmbeddedMigrationArtifact,
  verifyMigrationArtifact,
} from "../deploy/migration-artifact.mjs";

const fixture = async () => {
  const root = await mkdtemp(resolve(tmpdir(), "ai-crm-migration-artifact-"));
  await mkdir(resolve(root, "packages/database/migrations"), { recursive: true });
  await mkdir(resolve(root, "packages/platform-modules/audit/migrations"), { recursive: true });
  await writeFile(resolve(root, "packages/database/migrations/0000000001_base.sql"), "select 1;\n");
  await writeFile(resolve(root, "packages/database/migrations/0000000001_base.meta.json"), "{}\n");
  await writeFile(resolve(root, "packages/platform-modules/audit/migrations/0000000002_audit.sql"), "select 2;\n");
  return root;
};

test("builds a deterministic manifest for every reviewed migration directory and file", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const first = await buildMigrationManifest(root);
  const second = await buildMigrationManifest(root);
  assert.deepEqual(first, second);
  assert.deepEqual(first.migrationRoots, ["packages/database/migrations", "packages/platform-modules/audit/migrations"]);
  assert.equal(first.files.length, 3);
  assert.match(migrationManifestDigest(first), /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual((await verifyMigrationArtifact(root, first, migrationManifestDigest(first))).errors, []);
  await writeFile(resolve(root, MIGRATION_MANIFEST_RELATIVE_PATH), serializeMigrationManifest(first));
  assert.deepEqual((await verifyEmbeddedMigrationArtifact(root, migrationManifestDigest(first))).errors, []);
  const releaseGate = await verifyApplicationMigrationArtifacts(root, root, migrationManifestDigest(first));
  assert.deepEqual(releaseGate.api.errors, []);
  assert.deepEqual(releaseGate.worker.errors, []);
});

test("fails closed when an immutable application artifact omits its embedded manifest", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const result = await verifyEmbeddedMigrationArtifact(root, `sha256:${"0".repeat(64)}`);
  assert.ok(result.errors.some((error) => error.startsWith("Embedded migration manifest could not be read:")));
});

test("rejects symbolic links in migration ancestors and the embedded manifest", async (context) => {
  const root = await fixture();
  const external = await mkdtemp(resolve(tmpdir(), "ai-crm-external-migrations-"));
  context.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(external, { recursive: true, force: true }),
  ]));
  await rm(resolve(root, "packages/database"), { recursive: true });
  await symlink(external, resolve(root, "packages/database"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(buildMigrationManifest(root), /must not contain symbolic links/u);

  await rm(resolve(root, "packages/database"), { recursive: true, force: true });
  await mkdir(resolve(root, "packages/database/migrations"), { recursive: true });
  await writeFile(resolve(root, "packages/database/migrations/0000000001_base.sql"), "select 1;\n");
  const manifest = await buildMigrationManifest(root);
  if (process.platform === "win32") {
    await symlink(external, resolve(root, MIGRATION_MANIFEST_RELATIVE_PATH), "junction");
  } else {
    const externalManifest = resolve(external, "manifest.json");
    await writeFile(externalManifest, serializeMigrationManifest(manifest));
    await symlink(externalManifest, resolve(root, MIGRATION_MANIFEST_RELATIVE_PATH));
  }
  const result = await verifyEmbeddedMigrationArtifact(root, migrationManifestDigest(manifest));
  assert.ok(result.errors.some((error) => error.includes("regular file")));
});

test("rejects missing, modified, and unapproved migration artifact files", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manifest = await buildMigrationManifest(root);
  const expectedDigest = migrationManifestDigest(manifest);
  await writeFile(resolve(root, manifest.files[0].path), "changed\n");
  await writeFile(resolve(root, "packages/database/migrations/0000009999_unapproved.sql"), "select 9;\n");
  const result = await verifyMigrationArtifact(root, manifest, expectedDigest);
  assert.ok(result.errors.some((error) => error.includes("does not match approved digest")));
  assert.ok(result.errors.some((error) => error.includes("unapproved file")));
});

test("rejects missing migration directories and an unapproved manifest digest", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const manifest = await buildMigrationManifest(root);
  await rm(resolve(root, "packages/platform-modules/audit/migrations"), { recursive: true });
  const missingDirectory = await verifyMigrationArtifact(root, manifest, migrationManifestDigest(manifest));
  assert.ok(missingDirectory.errors.includes("Migration artifact directory set does not match the approved manifest."));
  const wrongDigest = await verifyMigrationArtifact(root, manifest, `sha256:${"0".repeat(64)}`);
  assert.ok(wrongDigest.errors.includes("Migration manifest digest does not match the approved release digest."));
});

test("rejects malformed versions, digests, and path traversal without reading outside the artifact", async () => {
  const malformed = {
    schemaVersion: 2,
    artifact: "ai-crm-reviewed-migrations",
    migrationRoots: ["packages/database/migrations"],
    files: [{ path: "packages/database/migrations/../outside", size: 1, sha256: "invalid" }],
  };
  const errors = validateMigrationManifest(malformed);
  assert.ok(errors.includes("Migration manifest schemaVersion must be 1."));
  assert.ok(errors.some((error) => error.includes("safe migration file path")));
  assert.ok(errors.some((error) => error.includes("sha256 digest")));
});

test("reports a missing file path without throwing from the validator", () => {
  const malformed = {
    schemaVersion: 1,
    artifact: "ai-crm-reviewed-migrations",
    migrationRoots: ["packages/database/migrations"],
    files: [{ size: 1, sha256: `sha256:${"0".repeat(64)}` }],
  };
  assert.doesNotThrow(() => validateMigrationManifest(malformed));
  assert.ok(validateMigrationManifest(malformed).some((error) => error.includes("files[0]")));
});
