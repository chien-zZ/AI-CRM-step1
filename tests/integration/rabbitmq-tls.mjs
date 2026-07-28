import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";

const require = createRequire(import.meta.url);
const amqp = require(resolve(import.meta.dirname, "../../apps/worker/node_modules/amqplib"));
const fixtureDirectory = process.env.AI_CRM_RABBITMQ_FIXTURE_DIR;
const port = Number(process.env.AI_CRM_TEST_RABBITMQ_TLS_PORT);
assert.ok(fixtureDirectory && resolve(fixtureDirectory) === fixtureDirectory, "fixture directory must be absolute");
assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535, "TLS port must be explicit");

const read = async (name) => (await readFile(resolve(fixtureDirectory, name), "utf8")).trim();
const ca = await readFile(resolve(fixtureDirectory, "ca.pem"));
const untrustedCa = await readFile(resolve(fixtureDirectory, "untrusted-ca.pem"));
const vhost = await read("vhost");
const credentials = {
  consumer: { username: await read("consumer_username"), password: await read("consumer_password") },
  publisher: { username: await read("publisher_username"), password: await read("publisher_password") },
};

function options(role, overrides = {}) {
  return {
    connection: {
      protocol: "amqps", hostname: "127.0.0.1", port, heartbeat: 10, vhost,
      username: credentials[role].username, password: credentials[role].password,
      ...overrides.connection,
    },
    socket: { ca: [ca], rejectUnauthorized: true, servername: "rabbitmq.integration.test", ...overrides.socket },
  };
}

async function connect(role, overrides) {
  const value = options(role, overrides);
  const connection = await amqp.connect(value.connection, value.socket);
  connection.on("error", () => undefined);
  return connection;
}

async function mustReject(label, operation) {
  await assert.rejects(operation, undefined, label);
  console.log(`PASS ${label}`);
}

await mustReject("untrusted CA is rejected", connect("publisher", { socket: { ca: [untrustedCa] } }));
await mustReject("missing CA is rejected", connect("publisher", { socket: { ca: [] } }));
await mustReject("hostname mismatch is rejected", connect("publisher", { socket: { servername: "wrong.integration.test" } }));
await mustReject("unknown VHost is rejected", connect("publisher", { connection: { vhost: "missing-vhost" } }));

const publisher = await connect("publisher");
const publishChannel = await publisher.createConfirmChannel();
publishChannel.on("error", () => undefined);
await mustReject("publisher cannot read the consumer queue", publishChannel.checkQueue("ai.crm.integration"));
await publishChannel.close().catch(() => undefined);

const confirmedChannel = await publisher.createConfirmChannel();
confirmedChannel.publish("ai.crm.events", "integration.ok", Buffer.from("confirmed"), { mandatory: true, persistent: true, messageId: "rabbit-integration-confirm" });
await confirmedChannel.waitForConfirms();
console.log("PASS publisher confirm over TLS");

const returned = new Promise((resolveReturn, reject) => {
  const timeout = setTimeout(() => reject(new Error("mandatory return timed out")), 10_000);
  confirmedChannel.once("return", (message) => { clearTimeout(timeout); resolveReturn(message); });
});
confirmedChannel.publish("ai.crm.events", "integration.unbound", Buffer.from("return"), { mandatory: true, persistent: true, messageId: "rabbit-integration-return" });
await confirmedChannel.waitForConfirms();
assert.equal((await returned).properties.messageId, "rabbit-integration-return");
console.log("PASS mandatory return over TLS");

const consumerDenied = await connect("consumer");
const deniedChannel = await consumerDenied.createConfirmChannel();
deniedChannel.on("error", () => undefined);
deniedChannel.publish("ai.crm.events", "integration.ok", Buffer.from("denied"), { persistent: true });
await mustReject("consumer cannot publish to the exchange", deniedChannel.waitForConfirms());
await deniedChannel.close().catch(() => undefined);
await consumerDenied.close().catch(() => undefined);

const consumer = await connect("consumer");
const consumeChannel = await consumer.createChannel();
const first = await consumeChannel.get("ai.crm.integration", { noAck: false });
assert.notEqual(first, false);
assert.equal(first.content.toString(), "confirmed");
consumeChannel.ack(first);
console.log("PASS consumer read permission and ACK");

confirmedChannel.publish("ai.crm.events", "integration.ok", Buffer.from("redeliver"), { mandatory: true, persistent: true, messageId: "rabbit-integration-redelivery" });
await confirmedChannel.waitForConfirms();
const unsettled = await consumeChannel.get("ai.crm.integration", { noAck: false });
assert.notEqual(unsettled, false);
await consumer.close();

const secondConsumer = await connect("consumer");
const secondChannel = await secondConsumer.createChannel();
const redelivered = await secondChannel.get("ai.crm.integration", { noAck: false });
assert.notEqual(redelivered, false);
assert.equal(redelivered.content.toString(), "redeliver");
assert.equal(redelivered.fields.redelivered, true);
secondChannel.ack(redelivered);
console.log("PASS unsettled delivery is redelivered after connection close");

await secondChannel.close();
await secondConsumer.close();
await confirmedChannel.close();
await publisher.close();
console.log("RabbitMQ 4.2.9 and amqplib 2.0.1 TLS integration matrix passed.");
