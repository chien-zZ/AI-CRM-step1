export const packageId = "@ai-crm/config" as const;

export {
  ConfigurationError,
  type ConfigurationErrorCode,
} from "./errors.js";
export {
  configuration,
  loadConfiguration,
  type ConfigurationField,
  type ConfigurationSchema,
  type InferConfiguration,
  type LoadConfigurationOptions,
} from "./schema.js";
export {
  readSecretFile,
  type SecretFileInfo,
  type SecretFilePolicy,
  type SecretFileSystem,
} from "./secret.js";
