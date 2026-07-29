import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("image publication can only be triggered by a push to main", async () => {
  const workflow = await read(".github/workflows/application-images.yml");
  assert.match(workflow, /on:\s*\n\s*push:\s*\n\s*branches: \[main\]/u);
  assert.doesNotMatch(workflow, /pull_request:/u);
  assert.doesNotMatch(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /github\.event_name/u);
});
