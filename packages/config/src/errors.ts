export type ConfigurationErrorCode =
  | "duplicate_variable"
  | "invalid_schema"
  | "invalid_value"
  | "missing_value"
  | "secret_permissions"
  | "secret_unreadable";

export class ConfigurationError extends Error {
  public readonly code: ConfigurationErrorCode;
  public readonly variable: string;

  public constructor(code: ConfigurationErrorCode, variable: string, message: string) {
    super(message);
    this.name = "ConfigurationError";
    this.code = code;
    this.variable = variable;
  }
}

const SAFE_VARIABLE = /^[A-Z][A-Z0-9_]{0,127}$/u;

export const configurationError = (
  code: ConfigurationErrorCode,
  variable: string,
): ConfigurationError => {
  const safeVariable = SAFE_VARIABLE.test(variable) ? variable : "INVALID_CONFIGURATION_VARIABLE";
  const descriptions: Record<ConfigurationErrorCode, string> = {
    duplicate_variable: "is assigned to more than one configuration field",
    invalid_schema: "has an invalid configuration field definition",
    invalid_value: "contains an invalid value",
    missing_value: "is required",
    secret_permissions: "references a Secret file with unsafe permissions",
    secret_unreadable: "references an unavailable or unsupported Secret file",
  };
  return new ConfigurationError(
    code,
    safeVariable,
    `Configuration variable ${safeVariable} ${descriptions[code]}.`,
  );
};
