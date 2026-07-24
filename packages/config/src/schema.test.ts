import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ConfigurationError,
  configuration,
  loadConfiguration,
  type InferConfiguration,
  type SecretFileSystem,
} from "./index.js";

const schema = {
  enabled: configuration.boolean("AI_CRM_FEATURE_ENABLED", { default: false }),
  environment: configuration.enumeration("AI_CRM_ENVIRONMENT", ["development", "test", "production"] as const),
  optionalLabel: configuration.optionalString("AI_CRM_OPTIONAL_LABEL", { maxLength: 32 }),
  port: configuration.integer("AI_CRM_PORT", { default: 3000, maximum: 65_535, minimum: 1 }),
  service: configuration.string("AI_CRM_SERVICE", { pattern: /^[a-z][a-z0-9-]+$/ }),
  upstream: configuration.url("AI_CRM_UPSTREAM", { protocols: ["http:", "https:"] }),
};

describe("typed configuration schema", () => {
  it("loads bounded values, applies defaults, preserves types, and freezes the result", async () => {
    const result = await loadConfiguration(schema, {
      env: {
        AI_CRM_ENVIRONMENT: "test",
        AI_CRM_SERVICE: "api-service",
        AI_CRM_UPSTREAM: "http://127.0.0.1:8080/health",
      },
    });

    expect(result).toEqual({
      enabled: false,
      environment: "test",
      optionalLabel: undefined,
      port: 3000,
      service: "api-service",
      upstream: "http://127.0.0.1:8080/health",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expectTypeOf(result).toEqualTypeOf<InferConfiguration<typeof schema>>();
  });

  it("rejects missing and invalid values without echoing their contents", async () => {
    await expect(loadConfiguration(schema, { env: {} })).rejects.toMatchObject({
      code: "missing_value",
      variable: "AI_CRM_ENVIRONMENT",
    });

    const unsafe = "https://user:do-not-repeat@example.test/path?token=secret";
    const failure = await loadConfiguration(schema, {
      env: {
        AI_CRM_ENVIRONMENT: "test",
        AI_CRM_SERVICE: "api-service",
        AI_CRM_UPSTREAM: unsafe,
      },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ConfigurationError);
    expect(String(failure)).not.toContain("do-not-repeat");
    expect(String(failure)).not.toContain("token=secret");
  });

  it("rejects non-canonical integers and duplicate environment variables", async () => {
    await expect(loadConfiguration({
      port: configuration.integer("AI_CRM_PORT", { maximum: 65_535, minimum: 1 }),
    }, { env: { AI_CRM_PORT: "1e3" } })).rejects.toMatchObject({ code: "invalid_value" });

    await expect(loadConfiguration({
      first: configuration.string("AI_CRM_DUPLICATE"),
      second: configuration.string("AI_CRM_DUPLICATE"),
    }, { env: { AI_CRM_DUPLICATE: "value" } })).rejects.toMatchObject({ code: "duplicate_variable" });

    await expect(loadConfiguration({
      port: configuration.integer("AI_CRM_PORT", { maximum: 1, minimum: 2 }),
    }, { env: { AI_CRM_PORT: "1" } })).rejects.toMatchObject({ code: "invalid_schema" });
  });

  it("requires restricted Secret permissions in production", async () => {
    const values = new Map<string, string>([["/secret", "synthetic-secret\n"]]);
    const fileSystem = (mode: number): SecretFileSystem => ({
      inspect: () => Promise.resolve({ isFile: true, isSymbolicLink: false, mode, size: 17 }),
      read: (filePath) => Promise.resolve(values.get(filePath) ?? ""),
    });
    const secretSchema = { password: configuration.secretFile("AI_CRM_PASSWORD_FILE") };

    await expect(loadConfiguration(secretSchema, {
      env: { AI_CRM_PASSWORD_FILE: "/secret", NODE_ENV: "production" },
      secretFilePolicy: { fileSystem: fileSystem(0o100644) },
    })).rejects.toMatchObject({ code: "secret_permissions" });

    await expect(loadConfiguration(secretSchema, {
      env: { AI_CRM_PASSWORD_FILE: "/secret", NODE_ENV: "production" },
      secretFilePolicy: { fileSystem: fileSystem(0o100440) },
    })).resolves.toEqual({ password: "synthetic-secret" });
  });

  it("maps malformed runtime schemas to a stable error", async () => {
    await expect(loadConfiguration({ invalid: null } as never, { env: {} }))
      .rejects.toMatchObject({
        code: "invalid_schema",
        variable: "INVALID_CONFIGURATION_VARIABLE",
      });
  });
});
