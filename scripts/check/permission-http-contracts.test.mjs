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

test("Task and Notification HTTP operations map to reviewed platform PermissionRequests", async () => {
  const [bindingSchema, catalogSchema, catalog, ...documents] = await Promise.all([
    readJson("contracts/permissions/http-permission-binding.v1.schema.json"),
    readJson("contracts/permissions/platform-permission-catalog.v1.schema.json"),
    readJson("contracts/permissions/platform-permission-catalog.v1.json"),
    readYaml("contracts/http/modules/task-center.openapi.yaml"),
    readYaml("contracts/http/modules/notifications.openapi.yaml"),
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
