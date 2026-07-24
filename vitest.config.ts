import { relative, resolve } from "node:path";
import { defineConfig } from "vitest/config";

const sharedTest = resolve(import.meta.dirname, "packages/test-config/src/package-smoke.test.ts");
const sharedTestPattern = relative(process.cwd(), sharedTest).replaceAll("\\", "/");

export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
    },
    include: [sharedTestPattern, "src/**/*.test.ts"],
    passWithNoTests: false,
  },
});
