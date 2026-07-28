const DURATION_PART = /([0-9]+(?:\.[0-9]+)?)(us|ms|s|m|h)/gyu;
const UNIT_MILLISECONDS = { us: 0.001, ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };

export const parseComposeDurationMilliseconds = (value) => {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || value.startsWith("${")) return undefined;
  let position = 0;
  let milliseconds = 0;
  DURATION_PART.lastIndex = 0;
  for (;;) {
    const match = DURATION_PART.exec(value);
    if (!match) break;
    if (match.index !== position) return undefined;
    milliseconds += Number(match[1]) * UNIT_MILLISECONDS[match[2]];
    position = DURATION_PART.lastIndex;
  }
  return position === value.length && position > 0 && Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : undefined;
};

export const validateRenderedWorkerDrain = (compose) => {
  const errors = [];
  const worker = compose?.services?.worker;
  if (!worker || typeof worker !== "object") return ["Rendered Compose must contain the worker service."];
  const drain = worker.environment?.AI_CRM_WORKER_DRAIN_TIMEOUT_SECONDS;
  const drainSeconds = typeof drain === "number" ? drain : (typeof drain === "string" && /^[1-9][0-9]*$/u.test(drain) ? Number(drain) : undefined);
  if (!Number.isSafeInteger(drainSeconds) || drainSeconds <= 0) {
    errors.push("Worker drain timeout must render as a positive integer number of seconds.");
  }
  const stopGraceMilliseconds = parseComposeDurationMilliseconds(worker.stop_grace_period);
  if (stopGraceMilliseconds === undefined) errors.push("Worker stop_grace_period must render as a positive Compose duration with explicit units.");
  if (Number.isSafeInteger(drainSeconds) && drainSeconds > 0 && stopGraceMilliseconds !== undefined && drainSeconds * 1_000 >= stopGraceMilliseconds) {
    errors.push("Worker drain timeout must be strictly less than stop_grace_period.");
  }
  return errors;
};

const exactKeys = (value, expected) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};

export const validatePreviousSessionKeyOverlay = (base, overlay, expectedProject) => {
  const errors = [];
  const secretName = "pc_session_previous_encryption_key";
  const idName = "AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_ID";
  const fileName = "AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_FILE";
  const baseApi = base?.services?.api;
  if (baseApi?.environment?.[idName] !== undefined || baseApi?.environment?.[fileName] !== undefined ||
    baseApi?.secrets?.includes(secretName) || base?.secrets?.[secretName] !== undefined) {
    errors.push("Base production Compose must not mount or configure the optional previous session key.");
  }
  if (overlay?.name !== expectedProject || !exactKeys(overlay?.services, ["api"]) || !exactKeys(overlay?.secrets, [secretName])) {
    errors.push("Previous session key overlay must target only the expected project API and named Secret.");
    return errors;
  }
  const api = overlay.services.api;
  if (!exactKeys(api, ["environment", "secrets"]) || !exactKeys(api.environment, [idName, fileName]) ||
    !Array.isArray(api.secrets) || api.secrets.length !== 1 || api.secrets[0] !== secretName) {
    errors.push("Previous session key overlay must add only the paired API ID, typed *_FILE and Secret mount.");
  }
  if (typeof api.environment?.[idName] !== "string" ||
    !api.environment[idName].startsWith("${AI_CRM_PC_SESSION_PREVIOUS_ENCRYPTION_KEY_ID:?")) {
    errors.push("Previous session key ID must fail closed when the rotation overlay is enabled.");
  }
  if (api.environment?.[fileName] !== `/run/secrets/${secretName}`) {
    errors.push("Previous session key must use the typed *_FILE path for its named Secret.");
  }
  if (overlay.secrets?.[secretName]?.file !== `\${AI_CRM_SECRET_ROOT:?secret root is required}/${secretName}`) {
    errors.push("Previous session key Secret must fail closed on a missing target-host file reference.");
  }
  return errors;
};
