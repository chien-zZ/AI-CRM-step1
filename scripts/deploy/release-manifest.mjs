import { readFile } from "node:fs/promises";

const EXACT_KEYS = (value, expected, path, errors) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object.`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    errors.push(`${path} must contain exactly: ${wanted.join(", ")}.`);
    return false;
  }
  return true;
};

const RELEASE_ID = /^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[1-9][0-9]{0,5}$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const EVIDENCE_REFERENCE = /^evidence:\/\/[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/u;
const APPLICATION_IMAGE = /^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9][A-Za-z0-9._-]{0,127})?@sha256:[a-f0-9]{64}$/u;
const PINNED_IMAGE = /^[a-z0-9][a-z0-9._/-]*(?::(?!latest(?:$|@))[A-Za-z0-9][A-Za-z0-9._-]{0,127})(?:@sha256:[a-f0-9]{64})?$/u;
const IMMUTABLE_IMAGE = /^[a-z0-9][a-z0-9._/-]*(?::(?!latest(?:$|@))[A-Za-z0-9][A-Za-z0-9._-]{0,127})?@sha256:[a-f0-9]{64}$/u;
const SECRET_KEY = /(?:password|secret|token|cookie|credential|private.?key|session.?key|dsn|authorization)/iu;

const assertSafeReference = (value, path, errors) => {
  if (typeof value !== "string" || !SAFE_REFERENCE.test(value)) errors.push(`${path} is not a bounded safe reference.`);
};

const scanKeys = (value, path, errors) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanKeys(item, `${path}[${index}]`, errors));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const approvedSecretEvidenceFlag = path === "manifest.gates" && key === "secretFiles";
    if (SECRET_KEY.test(key) && !approvedSecretEvidenceFlag) errors.push(`${path}.${key} is a forbidden Secret-like field.`);
    scanKeys(child, `${path}.${key}`, errors);
  }
};

const validateImages = (images, environment, errors) => {
  const keys = ["api", "edge", "worker", "postgres", "redis", "rabbitmq", "keycloak", "flowable", "clamav"];
  if (!EXACT_KEYS(images, keys, "images", errors)) return;
  for (const name of ["api", "edge", "worker"]) {
    if (typeof images[name] !== "string" || !APPLICATION_IMAGE.test(images[name])) {
      errors.push(`images.${name} must be an application image pinned by sha256 digest.`);
    }
  }
  for (const name of ["postgres", "redis", "rabbitmq", "keycloak", "flowable", "clamav"]) {
    const pattern = environment === "production" ? IMMUTABLE_IMAGE : PINNED_IMAGE;
    if (typeof images[name] !== "string" || !pattern.test(images[name])) {
      errors.push(environment === "production"
        ? `images.${name} must be pinned by sha256 digest for production.`
        : `images.${name} must use an explicit non-latest version, optionally with a digest.`);
    }
  }
};

const validateHosts = (hosts, errors) => {
  if (!Array.isArray(hosts) || hosts.length !== 2) {
    errors.push("hosts must contain exactly host-a and host-b.");
    return;
  }
  const expected = new Map([
    ["host-a", { project: "ai-crm-prod-a", services: ["api", "clamav", "edge", "flowable", "keycloak", "postgres", "rabbitmq", "redis"] }],
    ["host-b", { project: "ai-crm-prod-b", services: ["api", "edge", "worker"] }],
  ]);
  const seen = new Set();
  for (const [index, host] of hosts.entries()) {
    if (!EXACT_KEYS(host, ["id", "project", "services"], `hosts[${index}]`, errors)) continue;
    const expectedHost = expected.get(host.id);
    if (!expectedHost || seen.has(host.id)) {
      errors.push(`hosts[${index}].id must be unique host-a or host-b.`);
      continue;
    }
    seen.add(host.id);
    if (host.project !== expectedHost.project) errors.push(`${host.id}.project must be ${expectedHost.project}.`);
    if (!Array.isArray(host.services) || host.services.some((item) => typeof item !== "string")) {
      errors.push(`${host.id}.services must be a string array.`);
      continue;
    }
    const services = [...host.services].sort();
    if (services.length !== expectedHost.services.length || services.some((item, itemIndex) => item !== expectedHost.services[itemIndex])) {
      errors.push(`${host.id}.services must be exactly: ${expectedHost.services.join(", ")}.`);
    }
  }
  if (seen.size !== 2) errors.push("Both host-a and host-b placements are required.");
};

export const validateReleaseManifest = (manifest) => {
  const errors = [];
  const isManifest = EXACT_KEYS(manifest, [
    "schemaVersion", "releaseId", "environment", "operatorRef", "approverRef", "images", "artifacts", "hosts", "gates",
  ], "manifest", errors);
  scanKeys(manifest, "manifest", errors);
  if (!isManifest) return [...new Set(errors)];
  if (manifest.schemaVersion !== 1) errors.push("schemaVersion must be 1.");
  if (typeof manifest.releaseId !== "string" || !RELEASE_ID.test(manifest.releaseId)) errors.push("releaseId has an invalid format.");
  if (manifest.environment !== "staging" && manifest.environment !== "production") errors.push("environment must be staging or production.");
  assertSafeReference(manifest.operatorRef, "operatorRef", errors);
  assertSafeReference(manifest.approverRef, "approverRef", errors);
  if (manifest.operatorRef === manifest.approverRef) errors.push("operatorRef and approverRef must be distinct.");
  validateImages(manifest.images, manifest.environment, errors);
  if (EXACT_KEYS(manifest.artifacts, ["contracts", "generatedManifest", "migrationHead", "configuration"], "artifacts", errors)) {
    for (const [name, value] of Object.entries(manifest.artifacts)) {
      if (typeof value !== "string" || !SHA256.test(value)) errors.push(`artifacts.${name} must be a sha256 reference.`);
    }
  }
  validateHosts(manifest.hosts, errors);
  const gates = [
    "pnpmCheck", "contracts", "migrations", "integrationAndE2e", "stagingSmoke", "secretFiles", "observability",
    "restorePoint", "workerDrain", "rollback", "manualApproval",
  ];
  if (EXACT_KEYS(manifest.gates, gates, "gates", errors)) {
    for (const name of gates) {
      const gate = manifest.gates[name];
      if (!EXACT_KEYS(gate, ["evidenceRef", "evidenceDigest"], `gates.${name}`, errors)) continue;
      if (typeof gate.evidenceRef !== "string" || !EVIDENCE_REFERENCE.test(gate.evidenceRef)) {
        errors.push(`gates.${name}.evidenceRef must be a bounded evidence:// reference.`);
      }
      if (typeof gate.evidenceDigest !== "string" || !SHA256.test(gate.evidenceDigest)) {
        errors.push(`gates.${name}.evidenceDigest must be a sha256 reference.`);
      }
    }
  }
  return [...new Set(errors)];
};

export const readAndValidateReleaseManifest = async (path) => {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    return { errors: [`Release manifest could not be read as JSON: ${error instanceof Error ? error.message : "unknown error"}`] };
  }
  return { errors: validateReleaseManifest(manifest), manifest };
};

export const renderComposeVariables = (manifest, expectedEnvironment) => {
  const errors = validateReleaseManifest(manifest);
  if (errors.length > 0) throw new Error("Release manifest is invalid.");
  if (expectedEnvironment !== "staging" && expectedEnvironment !== "production") {
    throw new Error("Expected release environment must be staging or production.");
  }
  if (manifest.environment !== expectedEnvironment) throw new Error("Release manifest environment does not match the deployment target.");
  const names = ["api", "edge", "worker", "postgres", "redis", "rabbitmq", "keycloak", "flowable", "clamav"];
  return [
    `AI_CRM_RELEASE_ID=${manifest.releaseId}`,
    ...names.map((name) => `AI_CRM_${name.toUpperCase()}_IMAGE=${manifest.images[name]}`),
    "",
  ].join("\n");
};
