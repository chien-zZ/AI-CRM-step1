import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const outputRoot = join(appRoot, "dist", "h5");
const entrypointFiles = ["js/512.js", "css/app.css", "js/app.js"];
const entrypointBudgetBytes = 600 * 1024;
const forbiddenPatterns = [
  /developmentFixturePort/u,
  /fixture-task/u,
  /合成内部上下文/u,
  /session_key/u,
  /client_secret/u,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/u,
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return files.flat();
}

const files = await walk(outputRoot);
const sourceMaps = files.filter((file) => file.endsWith(".map"));
if (sourceMaps.length > 0) throw new Error(`Production source maps are forbidden: ${sourceMaps.map((file) => relative(appRoot, file)).join(", ")}`);

for (const file of files.filter((candidate) => candidate.endsWith(".js") || candidate.endsWith(".html"))) {
  const content = await readFile(file, "utf8");
  const matched = forbiddenPatterns.find((pattern) => pattern.test(content));
  if (matched) throw new Error(`Forbidden production bundle content ${String(matched)} in ${relative(appRoot, file)}`);
}

const entrypointSizes = await Promise.all(entrypointFiles.map(async (file) => (await stat(join(outputRoot, file))).size));
const entrypointBytes = entrypointSizes.reduce((sum, size) => sum + size, 0);
if (entrypointBytes > entrypointBudgetBytes) throw new Error(`H5 entrypoint is ${entrypointBytes} bytes; budget is ${entrypointBudgetBytes} bytes.`);

process.stdout.write(`Internal mobile bundle check passed (${entrypointBytes}/${entrypointBudgetBytes} bytes).\n`);
