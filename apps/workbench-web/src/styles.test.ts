import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("workbench responsive styles", () => {
  it("positions the offline notice below the fixed 48px header", async () => {
    const css = await readFile(resolve(process.cwd(), "src/styles.css"), "utf8");
    const offlineRule = css.match(/html\[data-connectivity="offline"\]::before\s*\{(?<body>[^}]+)\}/u)?.groups?.["body"];

    expect(offlineRule).toContain("inset: 48px 0 auto");
    expect(offlineRule).toContain("z-index: 999");
  });

  it("defines explicit 420px and 768px responsive boundaries", async () => {
    const css = await readFile(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(css).toContain("@media (max-width: 420px)");
    expect(css).toContain("@media (max-width: 768px)");
    expect(css).toContain("overflow-wrap: anywhere");
  });
});
