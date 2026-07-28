import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createSecureContext } from "node:tls";

export type RabbitAccountRole = "consumer" | "publisher";

export interface RabbitConnectionConfiguration {
  readonly ca: Buffer;
  readonly clientCertificate?: Buffer;
  readonly clientKey?: Buffer;
  readonly heartbeatSeconds: number;
  readonly hostname: string;
  readonly password: string;
  readonly port: number;
  readonly servername: string;
  readonly tls: true;
  readonly username: string;
  readonly vhost: string;
}

export interface RabbitSecretFileAccess {
  readonly access: (path: string, mode: number) => Promise<void>;
  readonly readFile: (path: string) => Promise<Buffer>;
  readonly stat: (path: string) => Promise<{ readonly isFile: () => boolean; readonly mode: number; readonly uid?: number }>;
}

const defaultFiles: RabbitSecretFileAccess = { access, readFile, stat };
const HOST = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/u;
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,127}$/u;

function required(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name];
  if (value === undefined || value.trim() === "") throw new Error("worker_rabbit_configuration_invalid");
  return value.trim();
}

function integer(source: NodeJS.ProcessEnv, name: string, minimum: number, maximum: number): number {
  const value = Number(required(source, name));
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error("worker_rabbit_configuration_invalid");
  return value;
}

async function secret(path: string, files: RabbitSecretFileAccess, encoding: "binary" | "text", requireRootOwner: boolean): Promise<Buffer | string> {
  if (!isAbsolute(path)) throw new Error("worker_rabbit_secret_invalid");
  try {
    const metadata = await files.stat(path);
    // Production mounts may be root:service-reader 0440. Group read is allowed;
    // group write/execute and every permission for other users remain forbidden.
    if (!metadata.isFile() || (metadata.mode & 0o037) !== 0 || (requireRootOwner && metadata.uid !== 0)) throw new Error("invalid");
    await files.access(path, constants.R_OK);
    const value = await files.readFile(path);
    if (value.byteLength === 0 || value.byteLength > 65_536) throw new Error("invalid");
    if (encoding === "binary") return value;
    const text = value.toString("utf8").replace(/[\r\n]+$/u, "");
    if (text.length === 0 || /[\r\n\0]/u.test(text)) throw new Error("invalid");
    return text;
  } catch {
    throw new Error("worker_rabbit_secret_invalid");
  }
}

export async function loadRabbitConnectionConfiguration(
  role: RabbitAccountRole,
  source: NodeJS.ProcessEnv = process.env,
  files: RabbitSecretFileAccess = defaultFiles,
): Promise<Readonly<RabbitConnectionConfiguration>> {
  const rolePrefix = `AI_CRM_RABBIT_${role.toUpperCase()}`;
  const requireRootOwner = source["NODE_ENV"] === "production";
  if (source["AI_CRM_RABBIT_TLS"] !== "true") throw new Error("worker_rabbit_tls_required");
  const hostname = required(source, "AI_CRM_RABBIT_HOST");
  const servername = required(source, "AI_CRM_RABBIT_SERVERNAME");
  const vhost = required(source, "AI_CRM_RABBIT_VHOST");
  if (!HOST.test(hostname) || !HOST.test(servername) || vhost === "/" || vhost.length > 127 || /[\0\r\n]/u.test(vhost)) throw new Error("worker_rabbit_configuration_invalid");
  const username = await secret(required(source, `${rolePrefix}_USERNAME_FILE`), files, "text", requireRootOwner);
  const password = await secret(required(source, `${rolePrefix}_PASSWORD_FILE`), files, "text", requireRootOwner);
  if (typeof username !== "string" || typeof password !== "string" || !USERNAME.test(username) || password.length > 1024) throw new Error("worker_rabbit_secret_invalid");
  const ca = await secret(required(source, "AI_CRM_RABBIT_CA_FILE"), files, "binary", requireRootOwner);
  if (!Buffer.isBuffer(ca)) throw new Error("worker_rabbit_secret_invalid");
  const certificatePath = source["AI_CRM_RABBIT_CLIENT_CERT_FILE"]?.trim();
  const keyPath = source["AI_CRM_RABBIT_CLIENT_KEY_FILE"]?.trim();
  if ((certificatePath === undefined || certificatePath === "") !== (keyPath === undefined || keyPath === "")) throw new Error("worker_rabbit_configuration_invalid");
  const clientCertificate = certificatePath ? await secret(certificatePath, files, "binary", requireRootOwner) : undefined;
  const clientKey = keyPath ? await secret(keyPath, files, "binary", requireRootOwner) : undefined;
  if ((clientCertificate !== undefined && !Buffer.isBuffer(clientCertificate)) || (clientKey !== undefined && !Buffer.isBuffer(clientKey))) throw new Error("worker_rabbit_secret_invalid");
  try {
    createSecureContext({ ca, ...(clientCertificate === undefined ? {} : { cert: clientCertificate, key: clientKey as Buffer }) });
  } catch {
    throw new Error("worker_rabbit_tls_material_invalid");
  }
  return Object.freeze({
    ca,
    ...(clientCertificate === undefined ? {} : { clientCertificate, clientKey: clientKey as Buffer }),
    heartbeatSeconds: integer(source, "AI_CRM_RABBIT_HEARTBEAT_SECONDS", 5, 120),
    hostname,
    password,
    port: integer(source, "AI_CRM_RABBIT_PORT", 1, 65_535),
    servername,
    tls: true,
    username,
    vhost,
  });
}
