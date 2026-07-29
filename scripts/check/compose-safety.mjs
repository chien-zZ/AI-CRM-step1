const CREDENTIAL_NAME = /(?:PASSWORD|SECRET|TOKEN|COOKIE|CREDENTIAL|PRIVATE_KEY|SESSION_KEY)/iu;

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

export const mergeComposeModels = (base, overlay) => {
  if (!object(base) || !object(overlay)) return clone(overlay);
  const merged = clone(base);
  for (const [key, value] of Object.entries(overlay)) {
    merged[key] = object(value) && object(merged[key]) ? mergeComposeModels(merged[key], value) : clone(value);
  }
  return merged;
};

const environmentEntries = (environment) => {
  if (Array.isArray(environment)) return environment.map((item) => {
    const separator = String(item).indexOf("=");
    return separator < 0 ? [String(item), undefined] : [String(item).slice(0, separator), String(item).slice(separator + 1)];
  });
  return object(environment) ? Object.entries(environment) : [];
};

export const validateEffectiveComposeSafety = (model, label, { production = false } = {}) => {
  const errors = [];
  for (const [serviceName, service] of Object.entries(model.services ?? {})) {
    if (!object(service)) continue;
    if (service.privileged === true) errors.push(`${label}/${serviceName} must not be privileged.`);
    if ((service.volumes ?? []).some((volume) => String(volume).includes("/var/run/docker.sock"))) {
      errors.push(`${label}/${serviceName} must not mount the Docker Socket.`);
    }
    if (production && (!service.security_opt?.includes("no-new-privileges:true") || !service.cap_drop?.includes("ALL"))) {
      errors.push(`${label}/${serviceName} must retain no-new-privileges and cap_drop ALL in the effective model.`);
    }
    for (const [name, rawValue] of environmentEntries(service.environment)) {
      const normalizedName = name.toUpperCase();
      if (!CREDENTIAL_NAME.test(name) || normalizedName.endsWith("_ID") || rawValue === undefined) continue;
      const value = String(rawValue);
      if (!normalizedName.endsWith("_FILE") || !value.startsWith("/run/secrets/")) {
        errors.push(`${label}/${serviceName} environment ${name} must be a typed /run/secrets file reference.`);
      }
    }
  }
  return errors;
};
