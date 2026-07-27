import { findExternalOperation } from "./contract-surface";
import type { SessionAdapter, SessionCredential } from "./session-adapters";

export type ExternalRequest = Readonly<{
  body?: unknown;
  id: string;
  method: string;
  path: string;
}>;

export type ExternalRequestAdapter = (input: Readonly<{
  credential?: SessionCredential;
  data?: unknown;
  method: string;
  url: string;
}>) => Promise<unknown>;

export type ExternalTransportResult = Readonly<{ kind: "ok"; value: unknown }> | Readonly<{ kind: "rejected" | "unavailable" }>;

export function createExternalTransport({ request, session }: { request: ExternalRequestAdapter; session: SessionAdapter }) {
  return {
    async execute(input: ExternalRequest): Promise<ExternalTransportResult> {
      const operation = findExternalOperation(input.id, input.method, input.path);
      if (operation === undefined) return { kind: "rejected" };
      const credential = session.credential();
      try {
        const requestInput = {
          url: operation.path,
          method: operation.method,
          data: input.body,
          ...(credential === undefined ? {} : { credential }),
        };
        const value = await request(requestInput);
        return { kind: "ok", value };
      } catch {
        return { kind: "unavailable" };
      }
    },
  };
}
