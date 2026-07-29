import { connect, type Socket } from "node:net";
import { FileCenterError, type MalwareScanner } from "@ai-crm/platform-file-center";

export interface ClamAvScannerOptions {
  readonly connect?: typeof connect;
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
}

function readResponse(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => { chunks.push(chunk); });
    socket.once("end", () => { resolve(Buffer.concat(chunks).toString("utf8").replace(/\0+$/u, "")); });
    socket.once("error", reject);
  });
}

export class ClamAvMalwareScanner implements MalwareScanner {
  readonly #connect: typeof connect;
  readonly #host: string;
  readonly #port: number;
  readonly #timeoutMs: number;

  constructor(options: ClamAvScannerOptions) {
    this.#connect = options.connect ?? connect;
    this.#host = options.host;
    this.#port = options.port;
    this.#timeoutMs = options.timeoutMs;
  }

  async scan(input: Parameters<MalwareScanner["scan"]>[0]): Promise<{ readonly outcome: "clean" | "malicious" | "unscannable"; readonly scannerVersion: string }> {
    if (!Number.isSafeInteger(input.maximumBytes) || input.maximumBytes < 1 || input.bytes.byteLength > input.maximumBytes) throw new FileCenterError("file_center_policy_rejected");
    const socket = this.#connect({ host: this.#host, port: this.#port });
    socket.setTimeout(this.#timeoutMs, () => { socket.destroy(new Error("clamav_timeout")); });
    const response = readResponse(socket);
    // The connection promise below can reject before control reaches the
    // response await. Attach a handler immediately so a single transport
    // failure never becomes an unhandled secondary rejection.
    void response.catch(() => undefined);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", () => {
          socket.write("zINSTREAM\0");
          const size = Buffer.alloc(4); size.writeUInt32BE(input.bytes.byteLength);
          socket.write(size); socket.write(input.bytes); socket.end(Buffer.alloc(4)); resolve();
        });
        socket.once("error", reject);
      });
      const result = await response;
      if (result.endsWith(" OK")) return { outcome: "clean", scannerVersion: "clamav" };
      if (result.includes(" FOUND")) return { outcome: "malicious", scannerVersion: "clamav" };
      if (result.includes(" ERROR")) return { outcome: "unscannable", scannerVersion: "clamav" };
      throw new Error("clamav_response_invalid");
    } catch (error) {
      throw new FileCenterError("file_center_scan_unavailable", { cause: error, retryable: true });
    } finally { socket.destroy(); }
  }
}
