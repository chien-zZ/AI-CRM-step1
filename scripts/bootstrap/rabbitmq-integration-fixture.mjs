import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

const directoryArgument = process.argv[2];
if (!directoryArgument || !isAbsolute(directoryArgument)) {
  console.error("Usage: node scripts/bootstrap/rabbitmq-integration-fixture.mjs <absolute-directory>");
  process.exit(1);
}

const directory = resolve(directoryArgument);
const vhost = "ai-crm-integration";
const users = {
  consumer: { name: "ai_crm_integration_consumer", password: randomBytes(32).toString("base64url") },
  publisher: { name: "ai_crm_integration_publisher", password: randomBytes(32).toString("base64url") },
};

function runOpenSsl(args) {
  const result = spawnSync("openssl", args, { cwd: directory, shell: false, stdio: "pipe" });
  if (result.status !== 0) {
    const detail = result.stderr?.toString().trim();
    throw new Error(`OpenSSL fixture generation failed${detail ? `: ${detail}` : "."}`);
  }
}

function rabbitPasswordHash(password) {
  const salt = randomBytes(4);
  return Buffer.concat([salt, createHash("sha256").update(salt).update(password).digest()]).toString("base64");
}

await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(resolve(directory, "server-ext.cnf"), [
  "subjectAltName=DNS:rabbitmq.integration.test,IP:127.0.0.1",
  "extendedKeyUsage=serverAuth",
  "keyUsage=digitalSignature,keyEncipherment",
  "",
].join("\n"), { mode: 0o600 });

runOpenSsl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=AI-CRM RabbitMQ Integration CA", "-keyout", "ca.key", "-out", "ca.pem"]);
runOpenSsl(["req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=rabbitmq.integration.test", "-keyout", "server.key", "-out", "server.csr"]);
runOpenSsl(["x509", "-req", "-days", "2", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-extfile", "server-ext.cnf", "-out", "server.pem"]);
runOpenSsl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=Untrusted Integration CA", "-keyout", "untrusted-ca.key", "-out", "untrusted-ca.pem"]);

const definitions = {
  rabbit_version: "4.2.9",
  users: Object.values(users).map((user) => ({
    name: user.name,
    password_hash: rabbitPasswordHash(user.password),
    hashing_algorithm: "rabbit_password_hashing_sha256",
    tags: [],
  })),
  vhosts: [{ name: vhost }],
  permissions: [
    { user: users.publisher.name, vhost, configure: "^$", write: "^ai\\.crm\\.events$", read: "^$" },
    { user: users.consumer.name, vhost, configure: "^$", write: "^$", read: "^ai\\.crm\\.integration$" },
  ],
  exchanges: [{ name: "ai.crm.events", vhost, type: "topic", durable: true, auto_delete: false, internal: false, arguments: {} }],
  queues: [{ name: "ai.crm.integration", vhost, durable: true, auto_delete: false, arguments: {} }],
  bindings: [{ source: "ai.crm.events", vhost, destination: "ai.crm.integration", destination_type: "queue", routing_key: "integration.ok", arguments: {} }],
};
await writeFile(resolve(directory, "definitions.json"), `${JSON.stringify(definitions)}\n`, { mode: 0o600 });
await writeFile(resolve(directory, "rabbitmq.conf"), [
  "listeners.tcp = none",
  "listeners.ssl.default = 5671",
  "ssl_options.cacertfile = /opt/ai-crm-rabbit-fixture/ca.pem",
  "ssl_options.certfile = /opt/ai-crm-rabbit-fixture/server.pem",
  "ssl_options.keyfile = /opt/ai-crm-rabbit-fixture/server.key",
  "ssl_options.verify = verify_peer",
  "ssl_options.fail_if_no_peer_cert = false",
  "management.load_definitions = /opt/ai-crm-rabbit-fixture/definitions.json",
  "loopback_users.guest = false",
  "",
].join("\n"), { mode: 0o600 });
await Promise.all(Object.entries(users).flatMap(([role, user]) => [
  writeFile(resolve(directory, `${role}_username`), `${user.name}\n`, { mode: 0o600 }),
  writeFile(resolve(directory, `${role}_password`), `${user.password}\n`, { mode: 0o600 }),
]));
await writeFile(resolve(directory, "vhost"), `${vhost}\n`, { mode: 0o600 });

for (const name of ["ca.key", "server.key", "untrusted-ca.key"]) await chmod(resolve(directory, name), 0o600);
console.log("RabbitMQ integration fixture material is ready in the requested temporary directory.");
