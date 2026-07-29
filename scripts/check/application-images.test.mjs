import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

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
