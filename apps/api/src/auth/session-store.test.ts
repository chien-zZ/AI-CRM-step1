import { describe, expect, it } from "vitest";

import type { LoginTransaction } from "./oidc.js";
import { createRedisBrowserSessionStore, type RedisCommandExecutor } from "./session-store.js";

const index = "i".repeat(43);
const state = "s".repeat(43);

class ScriptedExecutor implements RedisCommandExecutor {
  readonly commands: string[][] = [];
  readonly results: unknown[];

  constructor(results: unknown[]) {
    this.results = [...results];
  }

  sendCommand(arguments_: readonly string[]): Promise<unknown> {
    this.commands.push([...arguments_]);
    return Promise.resolve(this.results.shift());
  }
}

const transaction: LoginTransaction = Object.freeze({
  codeVerifier: "v".repeat(43),
  nonce: "n".repeat(43),
  returnTo: "/tasks",
  state,
});

describe("createRedisBrowserSessionStore", () => {
  it("stores a login transaction with NX and consumes it with GETDEL", async () => {
    const executor = new ScriptedExecutor(["OK", JSON.stringify(transaction)]);
    const store = createRedisBrowserSessionStore(executor);

    await store.storeLoginTransaction(index, transaction, 60_000);
    await expect(store.consumeLoginTransaction(index)).resolves.toEqual(transaction);
    expect(executor.commands[0]).toEqual([
      "SET", `ai-crm:auth:pc:login:${index}`, JSON.stringify(transaction), "PX", "60000", "NX",
    ]);
    expect(executor.commands[1]?.[0]).toBe("GETDEL");
  });

  it("uses a single Lua command for session touch and rotation", async () => {
    const record = {
      absoluteExpiresAtMs: 10_000,
      authenticatedAtMs: 1_000,
      createdAtMs: 1_000,
      csrfToken: "c".repeat(43),
      id: "d".repeat(43),
      revision: 0,
      tokens: {
        algorithm: "A256GCM",
        ciphertext: "ciphertext",
        initializationVector: "initialization",
        keyId: "key-1",
        tag: "authenticationtag",
        version: 2,
      },
    } as const;
    const executor = new ScriptedExecutor([JSON.stringify(record), 1]);
    const store = createRedisBrowserSessionStore(executor);

    await expect(store.getSession(index, 5_000, 2_000)).resolves.toEqual(record);
    await expect(store.rotateSession(index, "j".repeat(43), 0, record, 5_000)).resolves.toBe(true);
    expect(executor.commands[0]?.[0]).toBe("EVAL");
    expect(executor.commands[1]?.[0]).toBe("EVAL");
    expect(executor.commands[1]?.[2]).toBe("2");
  });

  it("keeps legacy v1 session records readable during the v2 rollout", async () => {
    const record = {
      absoluteExpiresAtMs: 10_000,
      authenticatedAtMs: 1_000,
      createdAtMs: 1_000,
      csrfToken: "c".repeat(43),
      id: "d".repeat(43),
      revision: 0,
      tokens: {
        algorithm: "A256GCM",
        ciphertext: "ciphertext",
        initializationVector: "initialization",
        keyId: "key-1",
        tag: "authenticationtag",
        version: 1,
      },
    } as const;
    const store = createRedisBrowserSessionStore(new ScriptedExecutor([JSON.stringify(record)]));
    await expect(store.getSession(index, 5_000, 2_000)).resolves.toEqual(record);
  });

  it("fails closed on malformed stored JSON", async () => {
    const store = createRedisBrowserSessionStore(new ScriptedExecutor(["{not-json"]));

    await expect(store.consumeLoginTransaction(index)).rejects.toMatchObject({
      code: "authentication_session_invalid",
    });
  });
});
