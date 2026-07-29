import assert from "node:assert/strict";
import test from "node:test";
import { mergeComposeModels, validateEffectiveComposeSafety } from "./compose-safety.mjs";

test("checks the effective merged service instead of the safe base fragment", () => {
  const base = { services: { api: { cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"] } } };
  const overlay = { services: { api: { privileged: true, cap_drop: [] } } };
  const errors = validateEffectiveComposeSafety(mergeComposeModels(base, overlay), "fixture", { production: true });
  assert.ok(errors.some((error) => error.includes("privileged")));
  assert.ok(errors.some((error) => error.includes("cap_drop ALL")));
});

test("detects credential literals in mapping and list environment forms", () => {
  for (const environment of [{ API_TOKEN: "literal" }, ["API_TOKEN=literal"]]) {
    const errors = validateEffectiveComposeSafety({ services: { api: { environment } } }, "fixture");
    assert.ok(errors.some((error) => error.includes("API_TOKEN")));
  }
  assert.deepEqual(validateEffectiveComposeSafety({ services: { api: {
    environment: ["API_TOKEN_FILE=/run/secrets/api_token"],
  } } }, "fixture"), []);
});
