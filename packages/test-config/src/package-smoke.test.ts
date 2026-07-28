import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("workspace package", () => {
  it("has an importable public entry point", async () => {
    const packageRoot = process.cwd();
    const manifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8")) as {
      name: string;
    };
    const sourceEntry = resolve(packageRoot, "src/index.ts");

    await access(sourceEntry);
    const publicEntry = (await import(sourceEntry)) as { packageId?: string; applicationId?: string };
    expect(publicEntry.packageId ?? publicEntry.applicationId).toBe(manifest.name);
  }, 30_000);
});
