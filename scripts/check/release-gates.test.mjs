import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { renderComposeVariables, validateReleaseManifest } from "../deploy/release-manifest.mjs";

const root = resolve(import.meta.dirname, "../..");
const fixture = JSON.parse(await readFile(resolve(root, "deploy/releases/release-manifest.example.json"), "utf8"));
const copy = () => JSON.parse(JSON.stringify(fixture));

test("accepts the synthetic immutable two-host release manifest repeatedly", () => {
  assert.deepEqual(validateReleaseManifest(copy()), []);
  assert.deepEqual(validateReleaseManifest(copy()), []);
});

test("renders only non-secret immutable Compose variables", () => {
  const variables = renderComposeVariables(copy(), "production");
  assert.match(variables, /^AI_CRM_RELEASE_ID=2026\.07\.26\.1$/mu);
  assert.match(variables, /^AI_CRM_API_IMAGE=.*@sha256:[a-f0-9]{64}$/mu);
  assert.doesNotMatch(variables, /operator|approver|password|secret|token|credential/iu);
});

test("binds rendered variables to the explicit deployment environment", () => {
  assert.throws(() => renderComposeVariables(copy(), "staging"), /does not match/u);
  assert.throws(() => renderComposeVariables(copy()), /must be staging or production/u);
});

test("requires every production image to be digest-pinned", () => {
  const manifest = copy();
  manifest.images.postgres = "postgres:17.5-bookworm";
  assert.ok(validateReleaseManifest(manifest).includes("images.postgres must be pinned by sha256 digest for production."));
});

test("rejects floating or digest-free application images", () => {
  const manifest = copy();
  manifest.images.api = "registry.example.invalid/ai-crm/api:latest";
  manifest.images.worker = "registry.example.invalid/ai-crm/worker:2026.07.26.1";
  assert.deepEqual(validateReleaseManifest(manifest).filter((error) => error.startsWith("images.")), [
    "images.api must be an application image pinned by sha256 digest.",
    "images.worker must be an application image pinned by sha256 digest.",
  ]);
});

test("fails closed when an approval or recovery gate is absent", () => {
  const manifest = copy();
  delete manifest.gates.restorePoint;
  const errors = validateReleaseManifest(manifest);
  assert.ok(errors.some((error) => error.startsWith("gates must contain exactly:")));
  assert.ok(!errors.some((error) => error.includes("undefined")));
});

test("rejects self-asserted boolean gates without evidence bindings", () => {
  const manifest = copy();
  manifest.gates.pnpmCheck = true;
  const errors = validateReleaseManifest(manifest);
  assert.ok(errors.includes("gates.pnpmCheck must be an object."));
});

test("rejects malformed evidence references and digests", () => {
  const manifest = copy();
  manifest.gates.contracts.evidenceRef = "https://untrusted.example/evidence";
  manifest.gates.contracts.evidenceDigest = "not-a-digest";
  const errors = validateReleaseManifest(manifest);
  assert.ok(errors.includes("gates.contracts.evidenceRef must be a bounded evidence:// reference."));
  assert.ok(errors.includes("gates.contracts.evidenceDigest must be a sha256 reference."));
});

test("requires a distinct operator and approver reference", () => {
  const manifest = copy();
  manifest.approverRef = manifest.operatorRef;
  assert.ok(validateReleaseManifest(manifest).includes("operatorRef and approverRef must be distinct."));
});

test("rejects Secret-like fields without echoing their value", () => {
  const manifest = copy();
  manifest.operatorToken = "do-not-repeat-this-value";
  const errors = validateReleaseManifest(manifest);
  assert.ok(errors.some((error) => error.includes("operatorToken is a forbidden Secret-like field")));
  assert.ok(errors.every((error) => !error.includes("do-not-repeat-this-value")));
});

test("rejects a cross-host Compose illusion or missing second API", () => {
  const manifest = copy();
  manifest.hosts[0].project = "ai-crm-prod";
  manifest.hosts[1].services = ["edge", "worker"];
  const errors = validateReleaseManifest(manifest);
  assert.ok(errors.includes("host-a.project must be ai-crm-prod-a."));
  assert.ok(errors.some((error) => error.startsWith("host-b.services must be exactly:")));
});

test("rejects malformed artifact evidence and unknown gates", () => {
  const manifest = copy();
  manifest.artifacts.contracts = "not-a-digest";
  manifest.gates.unreviewedBypass = true;
  const errors = validateReleaseManifest(manifest);
  assert.ok(errors.includes("artifacts.contracts must be a sha256 reference."));
  assert.ok(errors.some((error) => error.startsWith("gates must contain exactly:")));
});
