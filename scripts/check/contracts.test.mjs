import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { checkArtifacts, renderArtifacts } from "../contracts/generate.mjs";

const root = resolve(import.meta.dirname, "../..");

test("generated contract artifacts are deterministic and tamper evident", async () => {
  const first = await renderArtifacts(root);
  const second = await renderArtifacts(root);
  assert.deepEqual([...first], [...second]);

  const path = "contracts/generated/internal.openapi.json";
  const target = resolve(root, path);
  const original = await readFile(target, "utf8").catch(() => undefined);
  await writeFile(target, "tampered\n");
  try {
    assert((await checkArtifacts(root, first)).includes(`${path} differs from its generated source.`));
  } finally {
    if (original === undefined) await writeFile(target, first.get(path));
    else await writeFile(target, original);
  }
});
