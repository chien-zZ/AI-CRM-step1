import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const applicationRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tscPath = require.resolve("typescript/bin/tsc");

const configDeclarations = [
  "src/app.config.d.ts",
  "src/pages/forms/index.config.d.ts",
  "src/pages/home/index.config.d.ts",
  "src/pages/notifications/index.config.d.ts",
  "src/pages/status/index.config.d.ts",
  "src/pages/tasks/index.config.d.ts",
];

test("Taro config declarations use only the public package type boundary", async (context) => {
  const outputRoot = await mkdtemp(join(tmpdir(), "internal-mobile-declarations-"));
  context.after(() => rm(outputRoot, { force: true, recursive: true }));

  const compilation = spawnSync(
    process.execPath,
    [
      tscPath,
      "-p",
      "tsconfig.json",
      "--declaration",
      "--emitDeclarationOnly",
      "--declarationMap",
      "false",
      "--noEmit",
      "false",
      "--composite",
      "false",
      "--outDir",
      outputRoot,
    ],
    { cwd: applicationRoot, encoding: "utf8" },
  );

  assert.equal(compilation.status, 0, `${compilation.stdout}${compilation.stderr}`);

  for (const relativePath of configDeclarations) {
    const declaration = await readFile(join(outputRoot, relativePath), "utf8");
    assert.match(declaration, /import type Taro from "@tarojs\/taro";/u, relativePath);
    assert.doesNotMatch(declaration, /(?:\.pnpm|node_modules|[A-Z]:\\)/iu, relativePath);
  }
});
