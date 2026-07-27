import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { checkArtifacts, renderArtifacts, selectReferencedSchemas } from "../contracts/generate.mjs";
import "../../contracts/asyncapi/topology.contract.test.mjs";

const root = resolve(import.meta.dirname, "../..");

test("generated contract artifacts are deterministic and tamper evident", async () => {
  const first = await renderArtifacts(root);
  const second = await renderArtifacts(root);
  assert.deepEqual([...first], [...second]);

  const path = "contracts/generated/internal.openapi.json";
  const artifactRoot = await mkdtemp(resolve(tmpdir(), "ai-crm-contracts-"));
  try {
    for (const [artifactPath, content] of first) {
      const target = resolve(artifactRoot, artifactPath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    await writeFile(resolve(artifactRoot, path), "tampered\n");
    assert((await checkArtifacts(artifactRoot, first)).includes(`${path} differs from its generated source.`));
  } finally {
    await rm(artifactRoot, { force: true, recursive: true });
  }
});

test("AsyncAPI references resolve independently of the process working directory", async () => {
  const previous = process.cwd();
  const unrelated = await mkdtemp(resolve(tmpdir(), "ai-crm-contract-cwd-"));
  try {
    process.chdir(unrelated);
    await renderArtifacts(root);
  } finally {
    process.chdir(previous);
    await rm(unrelated, { force: true, recursive: true });
  }
});

test("audience bundles contain only schemas reachable from their allowlisted paths", () => {
  const schemas = {
    ExternalResult: {
      type: "object",
      properties: { item: { $ref: "#/components/schemas/SharedItem" } },
    },
    InternalOnly: { type: "object" },
    SharedItem: { type: "string" },
  };
  const externalPaths = {
    "/external": {
      get: {
        responses: {
          200: {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ExternalResult" } },
            },
          },
        },
      },
    },
  };

  assert.deepEqual(selectReferencedSchemas(schemas, externalPaths), {
    ExternalResult: schemas.ExternalResult,
    SharedItem: schemas.SharedItem,
  });
  assert.deepEqual(selectReferencedSchemas(schemas, {}), {});
});
