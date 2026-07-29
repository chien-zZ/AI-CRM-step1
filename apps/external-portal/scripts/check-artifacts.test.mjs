import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { checkArtifacts } from "./check-artifacts.mjs";

async function fixture({ h5Html = '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><script src="/js/app.js"></script><link rel="stylesheet" href="/css/app.css">', source = "export const safe = true;", weappApp = "safe" } = {}) {
  const workspace = await mkdtemp(join(tmpdir(), "external-portal-artifacts-"));
  const root = join(workspace, "apps", "external-portal");
  const files = {
    "src/index.ts": source,
    "dist/h5/index.html": h5Html,
    "dist/h5/js/app.js": "javascript",
    "dist/h5/css/app.css": "stylesheet",
    "dist/weapp/app.js": weappApp,
    "dist/weapp/app.json": "{}",
  };
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  await mkdir(join(root, "config"), { recursive: true });
  const reviewedClient = join(workspace, "packages", "api-client", "src", "external.ts");
  await mkdir(dirname(reviewedClient), { recursive: true });
  await writeFile(reviewedClient, "export const externalOperations = [];");
  await writeFile(join(root, "config", "index.ts"), `
    import { fileURLToPath } from "node:url";
    const externalClient = fileURLToPath(new URL("../../../packages/api-client/src/external.ts", import.meta.url));
    export const config = { alias: { "@ai-crm/api-client/external": externalClient } };
  `);
  return root;
}

function workspaceOf(appRoot) { return resolve(appRoot, "../.."); }

test("accepts safe dual-target artifacts within budgets", async (context) => {
  const root = await fixture();
  context.after(() => rm(workspaceOf(root), { force: true, recursive: true }));
  const result = await checkArtifacts({ appRoot: root });
  assert.equal(result.h5EntrypointBytes, 20);
  assert.equal(result.weappBytes, 6);
});

test("rejects non-allowlisted API client imports across supported module syntax", async (context) => {
  const forbiddenSpecifier = ["@ai-crm/api-client", "internal"].join("/");
  const sources = [
    `import { internalOperations } from "${forbiddenSpecifier}";`,
    'import "@ai-crm/api-client";',
    'export * from "@ai-crm/api-client";',
    'const internalClient = import("@ai-crm/api-client");',
    'const internalClient = require("@ai-crm/api-client");',
  ];
  const roots = await Promise.all(sources.map((source) => fixture({ source })));
  context.after(() => Promise.all(roots.map((root) => rm(workspaceOf(root), { force: true, recursive: true }))));
  for (const root of roots) await assert.rejects(checkArtifacts({ appRoot: root }), /imports a non-allowlisted API client/u);
});

test("rejects source maps, production fixture content, and budget overflow", async (context) => {
  const fixtureLeak = await fixture({ weappApp: "developmentFixturePort" });
  const oversized = await fixture();
  await writeFile(join(oversized, "dist", "weapp", "extra.js"), "x".repeat(20));
  const sourceMap = await fixture();
  await writeFile(join(sourceMap, "dist", "h5", "js", "app.js.map"), "{}");
  context.after(() => Promise.all([fixtureLeak, oversized, sourceMap].map((root) => rm(workspaceOf(root), { force: true, recursive: true }))));
  await assert.rejects(checkArtifacts({ appRoot: fixtureLeak }), /Forbidden external artifact content/u);
  await assert.rejects(checkArtifacts({ appRoot: oversized, weappBudgetBytes: 10 }), /weapp package is/u);
  await assert.rejects(checkArtifacts({ appRoot: sourceMap }), /source maps are forbidden/u);
});

test("rejects a decoy path string when the configured alias resolves elsewhere", async (context) => {
  const root = await fixture();
  context.after(() => rm(workspaceOf(root), { force: true, recursive: true }));
  const alternate = join(root, "src", "alternate-client.ts");
  await writeFile(alternate, "export const unsafe = true;");
  await writeFile(join(root, "config", "index.ts"), `
    import { fileURLToPath } from "node:url";
    // ../../../packages/api-client/src/external.ts is only a decoy comment.
    const externalClient = fileURLToPath(new URL("../src/alternate-client.ts", import.meta.url));
    export const config = { alias: { "@ai-crm/api-client/external": externalClient } };
  `);
  await assert.rejects(checkArtifacts({ appRoot: root }), /must resolve only to the generated external allowlist source/u);
});
