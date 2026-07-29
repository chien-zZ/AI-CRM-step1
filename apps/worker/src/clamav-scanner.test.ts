import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ClamAvMalwareScanner } from "./clamav-scanner.js";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.close(() => { resolve(); }); }))); });

async function scanner(response: string): Promise<ClamAvMalwareScanner> {
  const server = createServer((socket) => { socket.on("data", () => undefined); socket.on("end", () => { socket.end(`${response}\0`); }); });
  servers.push(server);
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test_server_address_invalid");
  return new ClamAvMalwareScanner({ host: "127.0.0.1", port: address.port, timeoutMs: 1_000 });
}

describe("ClamAvMalwareScanner", () => {
  it.each([
    ["stream: OK", "clean"],
    ["stream: Eicar-Test-Signature FOUND", "malicious"],
    ["stream: Heuristics.Encrypted.Zip ERROR", "unscannable"],
  ] as const)("classifies %s", async (response, outcome) => {
    await expect((await scanner(response)).scan({ bytes: new TextEncoder().encode("synthetic"), maximumBytes: 32 })).resolves.toEqual({ outcome, scannerVersion: "clamav" });
  });

  it("rejects content above the caller-owned byte ceiling without connecting", async () => {
    const scan = new ClamAvMalwareScanner({ host: "127.0.0.1", port: 1, timeoutMs: 100 });
    await expect(scan.scan({ bytes: new Uint8Array(2), maximumBytes: 1 })).rejects.toMatchObject({ code: "file_center_policy_rejected" });
  });

  it("classifies transport failure as retryable scanner unavailability", async () => {
    const scan = new ClamAvMalwareScanner({ host: "127.0.0.1", port: 1, timeoutMs: 100 });
    await expect(scan.scan({ bytes: new Uint8Array(1), maximumBytes: 1 })).rejects.toMatchObject({ code: "file_center_scan_unavailable", retryable: true });
  });
});
