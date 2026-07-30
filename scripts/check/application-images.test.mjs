import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { sanitizeApplicationArtifact, verifyApplicationArtifactHygiene } from "../deploy/application-artifact-hygiene.mjs";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const hygieneCli = fileURLToPath(new URL("../deploy/sanitize-application-artifact.mjs", import.meta.url));

const readJson = async (path) => JSON.parse(await read(path));

const exists = async (path) => access(path).then(() => true, () => false);

const write = async (path, content = "fixture\n") => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

const hygieneFixture = async (context) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "ai-crm-artifact-hygiene-"));
  context.after(() => rm(temporaryRoot, { force: true, recursive: true }));
  const artifact = resolve(temporaryRoot, "artifact");
  const workspacePackage = resolve(artifact, "node_modules", ".pnpm", "@ai-crm+runtime@file+packages+runtime", "node_modules", "@ai-crm", "runtime");
  const thirdPartyPackage = resolve(artifact, "node_modules", ".pnpm", "third-party@1.0.0", "node_modules", "third-party");
  await write(resolve(artifact, "dist", "main.js"), "export const applicationReady = true;\n");
  await write(resolve(artifact, "dist", "main.js.map"));
  await write(resolve(artifact, "dist", "main.test.js"));
  await write(resolve(artifact, "src", "main.ts"));
  await write(resolve(artifact, "coverage", "summary.json"));
  await write(resolve(artifact, ".turbo", "build.log"));
  await write(resolve(artifact, "tsconfig.build.tsbuildinfo"));
  await write(resolve(workspacePackage, "package.json"), JSON.stringify({ type: "module", exports: "./dist/index.js" }));
  await write(resolve(workspacePackage, "dist", "index.js"), "export const runtimeReady = true;\n");
  await write(resolve(workspacePackage, "dist", "index.js.map"));
  await write(resolve(workspacePackage, "dist", "index.test.js"));
  await write(resolve(workspacePackage, "src", "index.ts"));
  await write(resolve(workspacePackage, "test-fixtures", "provider.mjs"));
  await write(resolve(workspacePackage, ".turbo", "build.log"));
  await write(resolve(workspacePackage, "dist", "tsconfig.build.tsbuildinfo"));
  const internalLink = resolve(artifact, "node_modules", ".pnpm", "@ai-crm+consumer@file+packages+consumer", "node_modules", "@ai-crm", "runtime");
  await mkdir(dirname(internalLink), { recursive: true });
  await symlink(workspacePackage, internalLink, "junction");
  await write(resolve(thirdPartyPackage, "src", "required.js"), "export const required = true;\n");
  await write(resolve(thirdPartyPackage, "dist", "vendor.js.map"));
  await write(resolve(thirdPartyPackage, "dist", "vendor.test.js"));
  return { artifact, temporaryRoot, thirdPartyPackage, workspacePackage };
};

test("API and Worker images are patch-versioned, non-root production artifacts", async () => {
  for (const path of ["apps/api/Dockerfile", "apps/worker/Dockerfile"]) {
    const dockerfile = await read(path);
    assert.match(dockerfile, /FROM node:24\.15\.0-bookworm-slim AS build/u);
    assert.match(dockerfile, /FROM node:24\.15\.0-bookworm-slim AS runtime/u);
    assert.match(dockerfile, /pnpm --filter @ai-crm\/(?:api|worker) deploy --prod/u);
    assert.match(dockerfile, /generate-migration-manifest\.mjs \/opt\/application/u);
    assert.match(dockerfile, /COPY --from=build --chown=node:node/u);
    assert.match(dockerfile, /USER node/u);
    assert.doesNotMatch(dockerfile, /(?:SECRET|PASSWORD|TOKEN|PRIVATE_KEY)=/u);
  }
});

test("application production payloads whitelist compiled output without tests or source maps", async () => {
  for (const application of ["api", "worker"]) {
    const manifest = await readJson(`apps/${application}/package.json`);
    const buildConfig = await readJson(`apps/${application}/tsconfig.build.json`);
    const dockerfile = await read(`apps/${application}/Dockerfile`);

    assert.deepEqual(manifest.files, ["dist", "README.md"]);
    assert.match(manifest.scripts.build, /rmSync\('dist',\{recursive:true,force:true\}\)/u);
    assert.match(manifest.scripts.build, /tsc -b tsconfig\.build\.json --force/u);
    assert.equal(buildConfig.compilerOptions.sourceMap, false);
    assert.equal(buildConfig.compilerOptions.declarationMap, false);
    assert.ok(buildConfig.exclude.includes("src/**/*.test.ts"));
    assert.match(dockerfile, /test -f \/opt\/application\/dist\/main\.js/u);
    assert.match(dockerfile, /test ! -e \/opt\/application\/src/u);
    assert.match(dockerfile, /test ! -e \/opt\/application\/coverage/u);
    assert.match(dockerfile, /sanitize-application-artifact\.mjs \/opt\/application/u);
  }

  const workerDockerfile = await read("apps/worker/Dockerfile");
  assert.match(workerDockerfile, /test -f \/opt\/application\/dist\/worker-healthcheck\.mjs/u);
  assert.match(workerDockerfile, /test ! -e \/opt\/application\/test-fixtures/u);
});

test("artifact hygiene cleans and verifies only application-owned runtime files", async (context) => {
  const fixture = await hygieneFixture(context);
  const before = await verifyApplicationArtifactHygiene(fixture.artifact);
  assert.ok(before.errors.some((error) => error.includes("dist/main.js.map")));
  assert.ok(before.errors.some((error) => error.includes("@ai-crm/runtime/src")));

  const result = await sanitizeApplicationArtifact(fixture.artifact);
  assert.deepEqual(result.errors, []);
  assert.equal(result.workspaceRoots.length, 1);
  assert.equal(await exists(resolve(fixture.artifact, "src")), false);
  assert.equal(await exists(resolve(fixture.artifact, ".turbo")), false);
  assert.equal(await exists(resolve(fixture.artifact, "tsconfig.build.tsbuildinfo")), false);
  assert.equal(await exists(resolve(fixture.workspacePackage, "src")), false);
  assert.equal(await exists(resolve(fixture.workspacePackage, ".turbo")), false);
  assert.equal(await exists(resolve(fixture.workspacePackage, "dist", "tsconfig.build.tsbuildinfo")), false);
  assert.equal(await exists(resolve(fixture.workspacePackage, "dist", "index.js.map")), false);
  assert.equal(await exists(resolve(fixture.thirdPartyPackage, "src", "required.js")), true);
  assert.equal(await exists(resolve(fixture.thirdPartyPackage, "dist", "vendor.js.map")), true);
  assert.equal(await exists(resolve(fixture.thirdPartyPackage, "dist", "vendor.test.js")), true);

  const application = await import(`${pathToFileURL(resolve(fixture.artifact, "dist", "main.js")).href}?fixture=application`);
  const runtime = await import(`${pathToFileURL(resolve(fixture.workspacePackage, "dist", "index.js")).href}?fixture=runtime`);
  assert.equal(application.applicationReady, true);
  assert.equal(runtime.runtimeReady, true);
});

test("artifact hygiene never follows symbolic links outside the artifact", async (context) => {
  const fixture = await hygieneFixture(context);
  const externalDirectory = resolve(fixture.temporaryRoot, "external");
  const externalFile = resolve(externalDirectory, "keep.txt");
  await write(externalFile, "must remain\n");
  await rm(resolve(fixture.workspacePackage, "src"), { recursive: true });
  await symlink(resolve(fixture.thirdPartyPackage, "src"), resolve(fixture.workspacePackage, "src"), "junction");
  await rm(resolve(fixture.workspacePackage, "test-fixtures"), { recursive: true });
  await symlink(externalDirectory, resolve(fixture.workspacePackage, "test-fixtures"), "junction");
  await symlink(externalDirectory, resolve(fixture.workspacePackage, "escaped"), "junction");
  await symlink(externalDirectory, resolve(fixture.workspacePackage, "leak.map"), "junction");
  const externalPackageLink = resolve(fixture.artifact, "node_modules", ".pnpm", "@ai-crm+malicious@file+packages+malicious", "node_modules", "@ai-crm", "malicious");
  await mkdir(dirname(externalPackageLink), { recursive: true });
  await symlink(externalDirectory, externalPackageLink, "junction");

  const result = await sanitizeApplicationArtifact(fixture.artifact);
  assert.ok(result.errors.includes("artifact_link_escape"));
  assert.ok(result.errors.includes("artifact_package_root_escape"));
  assert.equal(await exists(resolve(fixture.workspacePackage, "src")), false);
  assert.equal(await exists(resolve(fixture.workspacePackage, "test-fixtures")), false);
  assert.equal(await exists(resolve(fixture.workspacePackage, "leak.map")), false);
  assert.equal(await exists(resolve(fixture.thirdPartyPackage, "src", "required.js")), true);
  assert.equal(await exists(externalFile), true);
  assert.equal(await readFile(externalFile, "utf8"), "must remain\n");
});

test("artifact hygiene rejects a pnpm store reached through an escaping node_modules ancestor", async (context) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "ai-crm-artifact-store-escape-"));
  context.after(() => rm(temporaryRoot, { force: true, recursive: true }));
  const artifact = resolve(temporaryRoot, "artifact");
  const externalNodeModules = resolve(temporaryRoot, "external-node-modules");
  const externalPackage = resolve(externalNodeModules, ".pnpm", "@ai-crm+runtime@file+packages+runtime", "node_modules", "@ai-crm", "runtime");
  const externalSource = resolve(externalPackage, "src", "keep.ts");
  await write(resolve(artifact, "dist", "main.js"), "export const ready = true;\n");
  await write(externalSource, "must remain\n");
  await symlink(externalNodeModules, resolve(artifact, "node_modules"), "junction");

  const result = await sanitizeApplicationArtifact(artifact);
  assert.ok(result.errors.includes("artifact_pnpm_store_escape"));
  assert.ok(result.errors.includes("artifact_workspace_roots_missing"));
  assert.equal(await readFile(externalSource, "utf8"), "must remain\n");
});

test("artifact hygiene CLI returns bounded success and failure diagnostics", async (context) => {
  const valid = await hygieneFixture(context);
  const success = spawnSync(process.execPath, [hygieneCli, valid.artifact], { encoding: "utf8" });
  assert.equal(success.status, 0);
  assert.match(success.stdout, /^Sanitized \d+ forbidden paths across the application and \d+ @ai-crm runtime packages\.\s*$/u);
  assert.equal(success.stderr, "");

  const invalid = await hygieneFixture(context);
  const externalDirectory = resolve(invalid.temporaryRoot, "private-external-target");
  await write(resolve(externalDirectory, "sensitive-name.txt"), "private-content-must-not-appear\n");
  const escapedPackage = resolve(invalid.artifact, "node_modules", ".pnpm", "@ai-crm+escaped@file+packages+escaped", "node_modules", "@ai-crm", "escaped");
  await mkdir(dirname(escapedPackage), { recursive: true });
  await symlink(externalDirectory, escapedPackage, "junction");
  const failure = spawnSync(process.execPath, [hygieneCli, invalid.artifact], { encoding: "utf8" });
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /artifact_package_root_escape/u);
  assert.doesNotMatch(failure.stderr, /private-external-target|sensitive-name|private-content/u);
});

test("image workflow verifies both extracted artifacts before publishing commit tags", async () => {
  const workflow = await read(".github/workflows/application-images.yml");
  const verify = workflow.indexOf("verify-application-migration-artifacts.mjs");
  const publish = workflow.indexOf("docker push");
  assert.ok(verify > 0 && publish > verify);
  assert.match(workflow, /ai-crm-api:\$\{GITHUB_SHA\}/u);
  assert.match(workflow, /ai-crm-worker:\$\{GITHUB_SHA\}/u);
  assert.match(workflow, /docker export/u);
  assert.match(workflow, /RepoDigests/u);
});

test("pull requests build and verify images while publication remains push-only", async () => {
  const workflow = await read(".github/workflows/application-images.yml");
  assert.match(workflow, /on:\s*\n\s*pull_request:\s*\n\s*push:\s*\n\s*branches: \[main\]/u);
  assert.match(workflow, /publish:\s*\n\s*if: github\.event_name == 'push'/u);
  assert.match(workflow, /publish:[\s\S]*packages: write[\s\S]*docker\/login-action@[a-f0-9]{40}[\s\S]*docker push/u);
  assert.doesNotMatch(workflow, /workflow_dispatch:/u);
});

test("workflows pin third-party actions, bound permissions, and timeouts", async () => {
  for (const path of [".github/workflows/ci.yml", ".github/workflows/application-images.yml"]) {
    const workflow = await read(path);
    assert.doesNotMatch(workflow, /uses:\s*[^\s]+@v\d+/u);
    assert.match(workflow, /uses:\s*[^\s]+@[a-f0-9]{40}/u);
    assert.match(workflow, /permissions:\s*\n\s+contents: read/u);
    assert.match(workflow, /timeout-minutes:\s*\d+/u);
  }
});
