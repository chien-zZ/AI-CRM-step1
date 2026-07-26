import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkBundle } from "./check-bundle.mjs";

async function fixture(html, files = {}) {
  const root = await mkdtemp(join(tmpdir(), "internal-mobile-bundle-"));
  await writeFile(join(root, "index.html"), html, "utf8");
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  return root;
}

test("derives hashed JavaScript and CSS entrypoints from index.html", async (context) => {
  const root = await fixture('<script defer src="/js/395.js"></script><script src="js/app.js"></script><link rel="stylesheet" href="/css/app.abc.css">', {
    "js/395.js": "a".repeat(11),
    "js/app.js": "b".repeat(13),
    "css/app.abc.css": "c".repeat(17),
  });
  context.after(() => rm(root, { force: true, recursive: true }));
  const result = await checkBundle({ outputRoot: root });
  assert.equal(result.entrypointBytes, 41);
  assert.deepEqual(result.entrypointReferences, ["/js/395.js", "js/app.js", "/css/app.abc.css"]);
});

test("ignores data-prefixed lookalikes and fails closed without real entrypoint attributes", async (context) => {
  const root = await fixture('<script data-src="/js/app.js"></script><link data-rel="stylesheet" data-href="/css/app.css">', {
    "js/app.js": "javascript",
    "css/app.css": "stylesheet",
  });
  context.after(() => rm(root, { force: true, recursive: true }));
  await assert.rejects(checkBundle({ outputRoot: root }), /no initial JavaScript entrypoint/u);
});

test("counts URL aliases for the same canonical asset only once", async (context) => {
  const root = await fixture('<script src="/js/app.js"></script><script src="js/app.js"></script><script src="/js/app.js?v=1"></script><link rel="stylesheet" href="/css/app.css">', {
    "js/app.js": "1234",
    "css/app.css": "5678",
  });
  context.after(() => rm(root, { force: true, recursive: true }));
  const result = await checkBundle({ budgetBytes: 8, outputRoot: root });
  assert.equal(result.entrypointBytes, 8);
  assert.equal(result.entrypointFiles.length, 2);
});

test("rejects external and traversal entrypoint references", async (context) => {
  const external = await fixture('<script src="https://example.invalid/app.js"></script><link rel="stylesheet" href="/css/app.css">', { "css/app.css": "x" });
  const traversal = await fixture('<script src="../outside.js"></script><link rel="stylesheet" href="/css/app.css">', { "css/app.css": "x" });
  context.after(() => Promise.all([rm(external, { force: true, recursive: true }), rm(traversal, { force: true, recursive: true })]));
  await assert.rejects(checkBundle({ outputRoot: external }), /External entrypoint reference is forbidden/u);
  await assert.rejects(checkBundle({ outputRoot: traversal }), /escapes the output root/u);
});

test("rejects missing assets and entrypoint budget overflow", async (context) => {
  const missing = await fixture('<script src="/js/missing.js"></script><link rel="stylesheet" href="/css/app.css">', { "css/app.css": "x" });
  const oversized = await fixture('<script src="/js/app.js"></script><link rel="stylesheet" href="/css/app.css">', { "js/app.js": "1234", "css/app.css": "5678" });
  context.after(() => Promise.all([rm(missing, { force: true, recursive: true }), rm(oversized, { force: true, recursive: true })]));
  await assert.rejects(checkBundle({ outputRoot: missing }), /Entrypoint asset is missing/u);
  await assert.rejects(checkBundle({ budgetBytes: 7, outputRoot: oversized }), /H5 entrypoint is 8 bytes; budget is 7 bytes/u);
});
