import { spawnSync } from "node:child_process";

const project = process.argv[2];
if (!project?.match(/^ai-crm-test-[a-z0-9][a-z0-9-]*$/)) {
  console.error("Refusing cleanup: project must match ai-crm-test-<run-id>.");
  process.exit(1);
}

const result = spawnSync("docker", [
  "compose",
  "-p",
  project,
  "-f",
  "deploy/compose/compose.base.yml",
  "-f",
  "deploy/compose/compose.test.yml",
  "down",
  "--volumes",
  "--remove-orphans",
], { stdio: "inherit", shell: false });

process.exit(result.status ?? 1);
