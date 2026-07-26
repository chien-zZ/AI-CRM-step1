import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("mobile responsive layout", () => {
  const stylesheet = readFileSync(resolve(process.cwd(), "src/app.scss"), "utf8");

  it("keeps a 320px floor and a compact layout covering 320px and 390px viewports", () => {
    expect(stylesheet).toContain("min-width: 320px");
    expect(stylesheet).toContain("@media (max-width: 420px)");
    expect(stylesheet).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
  });

  it("preserves safe-area spacing for an embedded H5 WebView", () => {
    expect(stylesheet).toContain("env(safe-area-inset-bottom)");
  });
});
