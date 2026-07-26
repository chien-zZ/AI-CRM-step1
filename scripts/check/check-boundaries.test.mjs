import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { analyzeBoundaries } from "./check-boundaries.mjs";

async function fixture(files) {
  const root = await mkdtemp(resolve(tmpdir(), "ai-crm-boundary-"));
  for (const [path, content] of Object.entries(files)) {
    const target = resolve(root, path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

test("rejects deep workspace imports", async (context) => {
  const root = await fixture({
    "packages/a/package.json": JSON.stringify({ name: "@ai-crm/a", dependencies: { "@ai-crm/b": "workspace:*" } }),
    "packages/a/src/index.ts": 'import "@ai-crm/b/internal";',
    "packages/b/package.json": JSON.stringify({ name: "@ai-crm/b" }),
    "packages/b/src/index.ts": "export {};",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  assert((await analyzeBoundaries(root)).some((error) => error.includes("deep-imports")));
});

test("allows only explicitly exported workspace subpaths", async (context) => {
  const root = await fixture({
    "packages/a/package.json": JSON.stringify({ name: "@ai-crm/a", dependencies: { "@ai-crm/b": "workspace:*" } }),
    "packages/a/src/index.ts": 'import "@ai-crm/b/external";',
    "packages/b/package.json": JSON.stringify({ name: "@ai-crm/b", exports: { ".": "./dist/index.js", "./external": "./dist/external.js" } }),
    "packages/b/src/index.ts": "export {};",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await analyzeBoundaries(root), []);
});

test("rejects a workspace subpath that is not explicitly exported", async (context) => {
  const root = await fixture({
    "packages/a/package.json": JSON.stringify({ name: "@ai-crm/a", dependencies: { "@ai-crm/b": "workspace:*" } }),
    "packages/a/src/index.ts": 'import "@ai-crm/b/internal";',
    "packages/b/package.json": JSON.stringify({ name: "@ai-crm/b", exports: { ".": "./dist/index.js", "./external": "./dist/external.js" } }),
    "packages/b/src/index.ts": "export {};",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  assert((await analyzeBoundaries(root)).some((error) => error.includes("deep-imports")));
});

test("rejects workspace dependency cycles", async (context) => {
  const root = await fixture({
    "packages/a/package.json": JSON.stringify({ name: "@ai-crm/a", dependencies: { "@ai-crm/b": "workspace:*" } }),
    "packages/a/src/index.ts": 'import "@ai-crm/b";',
    "packages/b/package.json": JSON.stringify({ name: "@ai-crm/b", dependencies: { "@ai-crm/a": "workspace:*" } }),
    "packages/b/src/index.ts": 'import "@ai-crm/a";',
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  assert((await analyzeBoundaries(root)).some((error) => error.includes("dependency cycle")));
});
