import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const contractsOnly = process.argv[2] === "contracts";

const required = contractsOnly
  ? [
      "contracts/http",
      "contracts/generated",
      "contracts/events",
      "contracts/asyncapi",
      "contracts/jobs",
      "contracts/models",
      "contracts/permissions",
      "contracts/errors",
      "contracts/forms",
      "contracts/configuration",
      "contracts/notifications",
    ]
  : [
      "AGENTS.md",
      "README.md",
      "pnpm-workspace.yaml",
      "turbo.json",
      "apps/api",
      "apps/worker",
      "apps/workbench-web",
      "apps/internal-mobile",
      "apps/external-portal",
      "packages/platform-modules",
      "packages/domain-modules/README.md",
      "packages/platform-sdk",
      "contracts/http",
      "contracts/events",
      "contracts/jobs",
      "contracts/forms",
      "contracts/configuration",
      "contracts/notifications",
      "tests/contract",
      "tests/integration",
      "tests/e2e",
      "docs/08-架构决策",
      "deploy/compose",
    ];

const forbiddenDuringFoundation = [
  "packages/domain-modules/leads",
  "packages/domain-modules/orders",
  "packages/domain-modules/settlements",
  "packages/domain-modules/partners",
  "apps/parttime-taro",
  "apps/company-dashboard",
];

const missing = required.filter((path) => !existsSync(resolve(root, path)));
const premature = contractsOnly
  ? []
  : forbiddenDuringFoundation.filter((path) => existsSync(resolve(root, path)));

if (missing.length > 0 || premature.length > 0) {
  if (missing.length > 0) {
    console.error("Missing required repository paths:");
    for (const path of missing) console.error(`- ${path}`);
  }

  if (premature.length > 0) {
    console.error("Premature business paths found during the foundation stage:");
    for (const path of premature) console.error(`- ${path}`);
  }

  process.exit(1);
}

console.log(
  contractsOnly
    ? "Contract directory structure is valid."
    : "Repository foundation structure is valid.",
);
