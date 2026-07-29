import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import YAML from "yaml";

const root = resolve(import.meta.dirname, "../..");
const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const readYaml = async (path) => YAML.parse(await readFile(resolve(root, path), "utf8"));

const protectedDocuments = [
  "contracts/http/modules/app-registry.openapi.yaml",
  "contracts/http/modules/file-center.openapi.yaml",
  "contracts/http/modules/form-schema.openapi.yaml",
  "contracts/http/modules/notifications.openapi.yaml",
  "contracts/http/modules/task-center.openapi.yaml",
];

test("protected platform HTTP operations map completely to reviewed platform PermissionRequests", async () => {
  const [bindingSchema, catalogSchema, catalog, ...documents] = await Promise.all([
    readJson("contracts/permissions/http-permission-binding.v1.schema.json"),
    readJson("contracts/permissions/platform-permission-catalog.v1.schema.json"),
    readJson("contracts/permissions/platform-permission-catalog.v1.json"),
    ...protectedDocuments.map(readYaml),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validateBinding = ajv.compile(bindingSchema);
  const validateCatalog = ajv.compile(catalogSchema);
  assert.equal(validateCatalog(catalog), true, JSON.stringify(validateCatalog.errors));

  const declarations = new Map(catalog.permissions.map((permission) => [permission.code, permission]));
  assert.equal(declarations.size, catalog.permissions.length, "permission codes must be unique");
  assert.equal(
    new Set(catalog.permissions.map((permission) => `${permission.resource}:${permission.action}`)).size,
    catalog.permissions.length,
    "PermissionRequest resource/action pairs must be unique",
  );
  for (const permission of catalog.permissions) {
    assert.equal(permission.code, `${permission.resource}:${permission.action}`, `${permission.code}: declaration code must match PermissionRequest`);
    assert.ok(permission.resource.startsWith(`${permission.owner}.`), `${permission.code}: resource must be owned by its declaring module`);
  }
  const usedCodes = new Set();

  for (const document of documents) {
    for (const pathItem of Object.values(document.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!methods.has(method)) continue;
        assert.deepEqual(operation["x-ai-crm-audiences"], ["internal"], `${operation.operationId}: protected platform surface must be internal-only`);
        const binding = operation["x-ai-crm-permission"];
        assert.equal(validateBinding(binding), true, `${operation.operationId}: ${JSON.stringify(validateBinding.errors)}`);
        assert.equal(binding.code, `${binding.resource}:${binding.action}`, `${operation.operationId}: code must match PermissionRequest`);
        const declaration = declarations.get(binding.code);
        assert.ok(declaration, `${operation.operationId}: permission must be declared in the platform catalog`);
        assert.deepEqual(
          { action: binding.action, code: binding.code, owner: binding.owner, resource: binding.resource },
          { action: declaration.action, code: declaration.code, owner: declaration.owner, resource: declaration.resource },
          `${operation.operationId}: HTTP binding must match its catalog declaration`,
        );
        usedCodes.add(binding.code);
      }
    }
  }

  assert.deepEqual(usedCodes, new Set(declarations.keys()), "catalog must not contain permissions unused by this HTTP surface");
  assert.ok(catalog.permissions.every((permission) => permission.scopeDimensions.length === 0));
  assert.equal(Object.hasOwn(catalog, "roles"), false);
  assert.equal(Object.hasOwn(catalog, "grants"), false);
});

test("protected platform management commands use a separate reviewed permission catalog", async () => {
  const [schema, catalog, httpCatalog] = await Promise.all([
    readJson("contracts/permissions/platform-management-permission-catalog.v1.schema.json"),
    readJson("contracts/permissions/platform-management-permission-catalog.v1.json"),
    readJson("contracts/permissions/platform-permission-catalog.v1.json"),
  ]);
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  assert.equal(validate(catalog), true, JSON.stringify(validate.errors));
  assert.deepEqual(catalog.permissions, [{
    action: "publish",
    code: "platform.authorization.policy:publish",
    owner: "platform.authorization",
    resource: "platform.authorization.policy",
    scopeDimensions: [],
  }]);
  const httpCodes = new Set(httpCatalog.permissions.map(({ code }) => code));
  assert.equal(httpCodes.has(catalog.permissions[0].code), false, "management authority must not imply an HTTP surface");
});

test("new platform HTTP contracts declare bounded CSRF and idempotency semantics", async () => {
  const documents = await Promise.all(protectedDocuments.slice(0, 3).map(readYaml));
  const operations = new Map();
  for (const document of documents) {
    for (const pathItem of Object.values(document.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!methods.has(method)) continue;
        assert.equal(typeof operation["x-ai-crm-csrf"]?.mode, "string", `${operation.operationId}: CSRF mode is required`);
        assert.equal(typeof operation["x-ai-crm-idempotency"]?.mode, "string", `${operation.operationId}: idempotency mode is required`);
        operations.set(operation.operationId, operation);
      }
    }
  }

  for (const operationId of ["createFileUploadSession", "confirmFileUpload"]) {
    const operation = operations.get(operationId);
    assert.equal(operation["x-ai-crm-csrf"].mode, "required");
    assert.equal(operation["x-ai-crm-csrf"].tokenHeader, "X-CSRF-Token");
    assert.equal(operation["x-ai-crm-csrf"].originCheck, "required");
    assert.equal(operation["x-ai-crm-idempotency"].mode, "required");
    assert.equal(operation["x-ai-crm-idempotency"].keyHeader, "Idempotency-Key");
    assert.equal(operation.responses["409"] !== undefined, true);
  }
  const createUpload = operations.get("createFileUploadSession");
  assert.equal(createUpload["x-ai-crm-idempotency"].durableReplay, "original-identities");
  assert.equal(createUpload["x-ai-crm-idempotency"].ephemeralGrant, "freshly-minted-within-original-session-expiry");
  assert.equal(Object.hasOwn(createUpload["x-ai-crm-idempotency"], "replay"), false, "upload replay must not claim the ephemeral grant is the original result");
  const confirmUpload = operations.get("confirmFileUpload");
  assert.equal(Object.hasOwn(confirmUpload.responses, "410"), false, "public File Center errors cannot distinguish expired upload sessions from other operation conflicts");
  assert.match(confirmUpload.responses["409"].description, /intentionally not distinguished/u);
  for (const operationId of ["getInternalApplicationRegistry", "resolveInternalApplicationDeepLink", "getFormRelease", "validateFormSubmission"]) {
    assert.equal(operations.get(operationId)["x-ai-crm-csrf"].mode, "not-required");
  }
  assert.equal(operations.get("createFileDownloadGrant")["x-ai-crm-idempotency"].mode, "audit-operation-only");

  const validation = operations.get("validateFormSubmission");
  assert.deepEqual(validation["x-ai-crm-request-limits"], {
    maxBodyBytes: 262144,
    jsonLimitTarget: "requestBody.data",
    maxJsonDepth: 32,
    jsonRootDepth: 1,
    maxJsonNodes: 10000,
    jsonNodeCounting: "object-array-and-scalar-values-including-data-root",
    enforcement: "before-authorization-and-service",
  });
  assert.equal(validation.responses["413"] !== undefined, true);
  assert.match(validation.responses["413"].description, /before authorization and before invoking Form Schema/u);

  const fileContract = JSON.stringify(documents[1]).toLowerCase();
  for (const forbidden of ["bucket", "objectkey", "objecthandle", "credential", "permanenturl", "scannerpayload"]) {
    assert.equal(fileContract.includes(forbidden), false, `File HTTP contract must not expose ${forbidden}`);
  }
});

test("permission binding schemas reject undeclared authority and mismatched shapes", async () => {
  const bindingSchema = await readJson("contracts/permissions/http-permission-binding.v1.schema.json");
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(bindingSchema);
  assert.equal(validate({
    version: 1,
    owner: "platform.task-center",
    code: "platform.task-center.task-projection:read",
    resource: "platform.task-center.task-projection",
    action: "read",
    role: "administrator",
  }), false);
  assert.equal(validate({
    version: 1,
    owner: "platform.task-center",
    code: "task:read",
    resource: "task",
    action: "read",
  }), false);
});
