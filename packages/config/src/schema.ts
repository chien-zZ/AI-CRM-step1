import { configurationError } from "./errors.js";
import { readSecretFile, type SecretFilePolicy } from "./secret.js";

const VARIABLE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const fieldLoader: unique symbol = Symbol("configuration-field-loader");

interface LoadContext {
  readonly env: NodeJS.ProcessEnv;
  readonly secretPolicy: SecretFilePolicy;
}

export interface ConfigurationField<T> {
  readonly secret: boolean;
  readonly variable: string;
  readonly [fieldLoader]: (context: LoadContext) => Promise<T>;
}

export type ConfigurationSchema = Readonly<Record<string, ConfigurationField<unknown>>>;

export type InferConfiguration<TSchema extends ConfigurationSchema> = Readonly<{
  [TKey in keyof TSchema]: TSchema[TKey] extends ConfigurationField<infer TValue> ? TValue : never;
}>;

export interface LoadConfigurationOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly secretFilePolicy?: SecretFilePolicy;
}

interface DefaultOption<T> {
  readonly default?: T;
}

interface StringOptions extends DefaultOption<string> {
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly pattern?: RegExp;
}

interface IntegerOptions extends DefaultOption<number> {
  readonly maximum: number;
  readonly minimum: number;
}

interface UrlOptions extends DefaultOption<string> {
  readonly protocols?: readonly string[];
}

const assertVariable = (variable: string, secret = false): void => {
  if (!VARIABLE_PATTERN.test(variable) || (secret && !variable.endsWith("_FILE"))) {
    throw configurationError("invalid_schema", variable);
  }
};

const rawValue = (
  variable: string,
  env: NodeJS.ProcessEnv,
  fallback: string | undefined,
): string => {
  const value = env[variable]?.trim() ?? fallback;
  if (value === undefined || value.length === 0) throw configurationError("missing_value", variable);
  return value;
};

const optionalRawValue = (variable: string, env: NodeJS.ProcessEnv): string | undefined => {
  const value = env[variable]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

const createField = <T>(
  variable: string,
  secret: boolean,
  loader: (context: LoadContext) => Promise<T> | T,
): ConfigurationField<T> => {
  assertVariable(variable, secret);
  return Object.freeze({
    [fieldLoader]: async (context: LoadContext): Promise<T> => loader(context),
    secret,
    variable,
  });
};

const isConfigurationField = (value: unknown): value is ConfigurationField<unknown> =>
  value !== null &&
  typeof value === "object" &&
  fieldLoader in value &&
  typeof value[fieldLoader] === "function" &&
  "variable" in value &&
  typeof value.variable === "string";

const parseString = (variable: string, value: string, options: StringOptions): string => {
  const minimum = options.minLength ?? 1;
  const maximum = options.maxLength ?? 4096;
  if (
    !Number.isInteger(minimum) ||
    !Number.isInteger(maximum) ||
    minimum < 0 ||
    maximum < minimum ||
    maximum > 1_048_576
  ) {
    throw configurationError("invalid_schema", variable);
  }
  const pattern = options.pattern === undefined
    ? undefined
    : new RegExp(options.pattern.source, options.pattern.flags.replace(/[gy]/g, ""));
  if (value.length < minimum || value.length > maximum || pattern?.test(value) === false) {
    throw configurationError("invalid_value", variable);
  }
  return value;
};

const parseInteger = (variable: string, value: string, options: IntegerOptions): number => {
  if (
    !Number.isSafeInteger(options.minimum) ||
    !Number.isSafeInteger(options.maximum) ||
    options.maximum < options.minimum
  ) {
    throw configurationError("invalid_schema", variable);
  }
  if (!/^-?(?:0|[1-9]\d*)$/.test(value)) throw configurationError("invalid_value", variable);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < options.minimum || parsed > options.maximum) {
    throw configurationError("invalid_value", variable);
  }
  return parsed;
};

const parseUrl = (variable: string, value: string, options: UrlOptions): string => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw configurationError("invalid_value", variable);
  }
  const protocols = options.protocols ?? ["https:"];
  if (
    !protocols.includes(parsed.protocol) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw configurationError("invalid_value", variable);
  }
  return parsed.toString();
};

export const configuration = {
  boolean: (variable: string, options: DefaultOption<boolean> = {}): ConfigurationField<boolean> =>
    createField(variable, false, ({ env }) => {
      const fallback = options.default === undefined ? undefined : String(options.default);
      const value = rawValue(variable, env, fallback);
      if (value !== "true" && value !== "false") throw configurationError("invalid_value", variable);
      return value === "true";
    }),

  enumeration: <const TValues extends readonly [string, ...string[]]>(
    variable: string,
    values: TValues,
    options: DefaultOption<TValues[number]> = {},
  ): ConfigurationField<TValues[number]> => createField(variable, false, ({ env }) => {
    const value = rawValue(variable, env, options.default);
    if (!values.includes(value)) throw configurationError("invalid_value", variable);
    return value;
  }),

  integer: (variable: string, options: IntegerOptions): ConfigurationField<number> =>
    createField(variable, false, ({ env }) => {
      const fallback = options.default === undefined ? undefined : String(options.default);
      return parseInteger(variable, rawValue(variable, env, fallback), options);
    }),

  optionalSecretFile: (variable: string): ConfigurationField<string | undefined> =>
    createField(variable, true, async ({ env, secretPolicy }) => {
      const filePath = optionalRawValue(variable, env);
      return filePath === undefined ? undefined : readSecretFile(variable, filePath, secretPolicy);
    }),

  optionalString: (variable: string, options: StringOptions = {}): ConfigurationField<string | undefined> =>
    createField(variable, false, ({ env }) => {
      const value = optionalRawValue(variable, env);
      return value === undefined ? undefined : parseString(variable, value, options);
    }),

  optionalUrl: (variable: string, options: UrlOptions = {}): ConfigurationField<string | undefined> =>
    createField(variable, false, ({ env }) => {
      const value = optionalRawValue(variable, env);
      return value === undefined ? undefined : parseUrl(variable, value, options);
    }),

  secretFile: (variable: string): ConfigurationField<string> =>
    createField(variable, true, async ({ env, secretPolicy }) => {
      const filePath = rawValue(variable, env, undefined);
      return readSecretFile(variable, filePath, secretPolicy);
    }),

  string: (variable: string, options: StringOptions = {}): ConfigurationField<string> =>
    createField(variable, false, ({ env }) => parseString(
      variable,
      rawValue(variable, env, options.default),
      options,
    )),

  url: (variable: string, options: UrlOptions = {}): ConfigurationField<string> =>
    createField(variable, false, ({ env }) => parseUrl(
      variable,
      rawValue(variable, env, options.default),
      options,
    )),
} as const;

export const loadConfiguration = async <const TSchema extends ConfigurationSchema>(
  schema: TSchema,
  options: LoadConfigurationOptions = {},
): Promise<InferConfiguration<TSchema>> => {
  const env = options.env ?? process.env;
  const secretPolicy = {
    ...options.secretFilePolicy,
    enforcePermissions:
      env["NODE_ENV"] === "production" || options.secretFilePolicy?.enforcePermissions === true,
  };
  const variables = new Set<string>();
  const result: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(schema)) {
    if (!isConfigurationField(field)) {
      throw configurationError("invalid_schema", key);
    }
    if (variables.has(field.variable)) throw configurationError("duplicate_variable", field.variable);
    variables.add(field.variable);
    result[key] = await field[fieldLoader]({ env, secretPolicy });
  }
  return Object.freeze(result) as InferConfiguration<TSchema>;
};
