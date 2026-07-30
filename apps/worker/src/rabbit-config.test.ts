import { rootCertificates } from "node:tls";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRabbitConnectionConfiguration, type RabbitSecretFileAccess } from "./rabbit-config.js";

const secretPath = (name: string) => resolve(import.meta.dirname, "__synthetic-secrets__", name);
const secretPaths = {
  ca: secretPath("ca.pem"),
  consumerPassword: secretPath("consumer-password"),
  consumerUsername: secretPath("consumer-username"),
} as const;

const baseEnvironment = (): NodeJS.ProcessEnv => ({
  AI_CRM_RABBIT_CA_FILE: secretPaths.ca,
  AI_CRM_RABBIT_CONSUMER_PASSWORD_FILE: secretPaths.consumerPassword,
  AI_CRM_RABBIT_CONSUMER_USERNAME_FILE: secretPaths.consumerUsername,
  AI_CRM_RABBIT_HEARTBEAT_SECONDS: "30",
  AI_CRM_RABBIT_HOST: "rabbit.internal",
  AI_CRM_RABBIT_PORT: "5671",
  AI_CRM_RABBIT_SERVERNAME: "rabbit.internal",
  AI_CRM_RABBIT_TLS: "true",
  AI_CRM_RABBIT_VHOST: "ai-crm-test",
});

function files(overrides: Readonly<Record<string, Buffer>> = {}, mode = 0o100600, uid = 0): RabbitSecretFileAccess {
  const values: Readonly<Record<string, Buffer>> = {
    [secretPaths.ca]: Buffer.from(rootCertificates[0] ?? ""),
    [secretPaths.consumerPassword]: Buffer.from("synthetic-password\n"),
    [secretPaths.consumerUsername]: Buffer.from("synthetic-consumer\n"),
    ...overrides,
  };
  return {
    access: (path) => path in values ? Promise.resolve() : Promise.reject(new Error("missing")),
    readFile: (path) => path in values ? Promise.resolve(values[path] as Buffer) : Promise.reject(new Error("missing")),
    stat: (path) => Promise.resolve({ isFile: () => path in values, mode, uid }),
  };
}

describe("Rabbit file configuration", () => {
  it("loads separate account files, trims one trailing newline and keeps TLS verification mandatory", async () => {
    await expect(loadRabbitConnectionConfiguration("consumer", baseEnvironment(), files())).resolves.toMatchObject({
      heartbeatSeconds: 30,
      hostname: "rabbit.internal",
      password: "synthetic-password",
      port: 5671,
      servername: "rabbit.internal",
      tls: true,
      username: "synthetic-consumer",
      vhost: "ai-crm-test",
    });
  });

  it("accepts a production root-owned group-reader 0440 Secret", async () => {
    await expect(loadRabbitConnectionConfiguration("consumer", { ...baseEnvironment(), NODE_ENV: "production" }, files({}, 0o100440, 0)))
      .resolves.toMatchObject({ username: "synthetic-consumer" });
  });

  it.each([
    ["missing Secret", {}, files({ [secretPaths.consumerPassword]: undefined as never })],
    ["empty Secret", {}, files({ [secretPaths.consumerPassword]: Buffer.alloc(0) })],
    ["embedded newline", {}, files({ [secretPaths.consumerPassword]: Buffer.from("bad\nvalue") })],
    ["group-writable mode", {}, files({}, 0o100660)],
    ["group-executable mode", {}, files({}, 0o100450)],
    ["other-readable mode", {}, files({}, 0o100644)],
    ["non-root production owner", { NODE_ENV: "production" }, files({}, 0o100600, 1000)],
    ["default VHost", { AI_CRM_RABBIT_VHOST: "/" }, files()],
    ["disabled TLS", { AI_CRM_RABBIT_TLS: "false" }, files()],
  ])("fails closed for %s", async (_label, override, secretFiles) => {
    await expect(loadRabbitConnectionConfiguration("consumer", { ...baseEnvironment(), ...override }, secretFiles)).rejects.toThrow(/^worker_rabbit_/u);
  });

  it("does not fall back to plaintext credential environment values", async () => {
    const environment = { ...baseEnvironment(), AI_CRM_RABBIT_CONSUMER_PASSWORD: "forbidden", AI_CRM_RABBIT_CONSUMER_PASSWORD_FILE: undefined };
    await expect(loadRabbitConnectionConfiguration("consumer", environment, files())).rejects.toThrow("worker_rabbit_configuration_invalid");
  });
});
