import assert from "node:assert/strict";
import test from "node:test";
import {
  parseComposeDurationMilliseconds,
  validatePreviousSessionKeyOverlay,
  validateRenderedWorkerDrain,
} from "./production-deployment-gates.mjs";

test("parses Compose durations numerically including compound and subsecond units", () => {
  assert.equal(parseComposeDurationMilliseconds("1h2m3.5s4ms500us"), 3_723_504.5);
  assert.equal(parseComposeDurationMilliseconds("30s"), 30_000);
  assert.equal(parseComposeDurationMilliseconds("250ms"), 250);
});

test("rejects unresolved, unitless, zero, negative, spaced, and unknown durations", () => {
  for (const value of ["${STOP:?required}", "30", "0s", "-1s", " 30s", "30s ", "1d", "1sbad", ""]) {
    assert.equal(parseComposeDurationMilliseconds(value), undefined, value);
  }
});

test("accepts only a rendered positive integer drain strictly below stop grace", () => {
  assert.deepEqual(validateRenderedWorkerDrain({
    services: { worker: { environment: { AI_CRM_WORKER_DRAIN_TIMEOUT_SECONDS: "29" }, stop_grace_period: "30s" } },
  }), []);
  assert.deepEqual(validateRenderedWorkerDrain({
    services: { worker: { environment: { AI_CRM_WORKER_DRAIN_TIMEOUT_SECONDS: 1 }, stop_grace_period: "1001ms" } },
  }), []);
});

test("fails closed when drain equals/exceeds grace or either value is not concretely parseable", () => {
  for (const [drain, grace, expected] of [
    [30, "30s", "strictly less"],
    [31, "30s", "strictly less"],
    ["${DRAIN:?required}", "30s", "positive integer"],
    ["29.5", "30s", "positive integer"],
    [29, "${GRACE:?required}", "explicit units"],
  ]) {
    assert.ok(validateRenderedWorkerDrain({ services: { worker: {
      environment: { AI_CRM_WORKER_DRAIN_TIMEOUT_SECONDS: drain }, stop_grace_period: grace,
    } } }).some((error) => error.includes(expected)));
  }
});

const previousOverlay = () => ({
  name: "ai-crm-prod-a",
  services: { api: {
    environment: {
      AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_ID: "${AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_ID:?required}",
      AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_FILE: "/run/secrets/pc_session_previous_encryption_key",
    },
    secrets: ["pc_session_previous_encryption_key"],
  } },
  secrets: { pc_session_previous_encryption_key: {
    file: "${AI_CRM_SECRET_ROOT:?secret root is required}/pc_session_previous_encryption_key",
  } },
});

test("keeps the previous session key absent by default and mounts only its typed file when opted in", () => {
  const base = { services: { api: { environment: {}, secrets: ["pc_session_encryption_key"] } }, secrets: {} };
  assert.deepEqual(validatePreviousSessionKeyOverlay(base, previousOverlay(), "ai-crm-prod-a"), []);
});

test("rejects accidental base mounts and incomplete or non-failing previous-key overlays", () => {
  const base = { services: { api: { environment: {}, secrets: ["pc_session_previous_encryption_key"] } }, secrets: {} };
  const overlay = previousOverlay();
  delete overlay.services.api.environment.AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_ID;
  overlay.secrets.pc_session_previous_encryption_key.file = "/untyped/optional/path";
  const errors = validatePreviousSessionKeyOverlay(base, overlay, "ai-crm-prod-a");
  assert.ok(errors.some((error) => error.includes("Base production Compose")));
  assert.ok(errors.some((error) => error.includes("paired API ID")));
  assert.ok(errors.some((error) => error.includes("fail closed")));
});
