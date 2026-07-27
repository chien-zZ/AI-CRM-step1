import { describe, expect, it, vi } from "vitest";
import { createH5SessionAdapter } from "./session-adapters";
import { createExternalTransport } from "./transport";

describe("external transport", () => {
  it("rejects unknown and internal-looking operations before network I/O", async () => {
    const request = vi.fn().mockResolvedValue({});
    const transport = createExternalTransport({ request, session: createH5SessionAdapter() });
    await expect(transport.execute({ id: "listTasks", method: "GET", path: "/tasks" })).resolves.toEqual({ kind: "rejected" });
    await expect(transport.execute({ id: "unknown", method: "GET", path: "/external/unknown" })).resolves.toEqual({ kind: "rejected" });
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps repeated rejected attempts deterministic and side-effect free", async () => {
    const request = vi.fn();
    const transport = createExternalTransport({ request, session: createH5SessionAdapter() });
    const attempt = { id: "not-allowed", method: "POST", path: "/not-allowed", body: { ignored: true } };
    expect(await Promise.all([transport.execute(attempt), transport.execute(attempt)])).toEqual([{ kind: "rejected" }, { kind: "rejected" }]);
    expect(request).not.toHaveBeenCalled();
  });
});
