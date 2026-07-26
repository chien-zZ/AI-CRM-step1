import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const appRoot = resolve(dirname(scriptPath), "..");
const defaultOutputRoot = join(appRoot, "dist", "h5");
export const entrypointBudgetBytes = 600 * 1024;
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

function attribute(tag, name) {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, "iu").exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

export function initialAssetReferences(html) {
  const references = [];
  for (const tag of html.match(/<script\b[^>]*>/giu) ?? []) {
    const source = attribute(tag, "src");
    if (source !== undefined) references.push(source);
  }
  for (const tag of html.match(/<link\b[^>]*>/giu) ?? []) {
    const relation = attribute(tag, "rel")?.toLowerCase().split(/\s+/u) ?? [];
    const href = attribute(tag, "href");
    if (relation.includes("stylesheet") && href !== undefined) references.push(href);
  }
  return [...new Set(references)];
}

async function resolveInitialAsset(outputRoot, outputRootReal, reference) {
  if (reference.includes("\\")) throw new Error(`Entrypoint reference contains a forbidden backslash: ${reference}`);
  let decodedReference;
  try {
    decodedReference = decodeURIComponent(reference.split(/[?#]/u, 1)[0] ?? "");
  } catch {
    throw new Error(`Entrypoint reference is not valid URL encoding: ${reference}`);
  }
  if (decodedReference.split("/").includes("..")) throw new Error(`Entrypoint reference escapes the output root: ${reference}`);

  const base = new URL("https://internal-mobile.invalid/index.html");
  let parsed;
  try {
    parsed = new URL(reference, base);
  } catch {
    throw new Error(`Entrypoint reference is not a valid URL: ${reference}`);
  }
  if (parsed.origin !== base.origin || parsed.username !== "" || parsed.password !== "") {
    throw new Error(`External entrypoint reference is forbidden: ${reference}`);
  }

  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    throw new Error(`Entrypoint path is not valid URL encoding: ${reference}`);
  }
  const candidate = resolve(outputRoot, `.${pathname}`);
  const candidateRelative = relative(outputRoot, candidate);
  if (candidateRelative === "" || candidateRelative === ".." || candidateRelative.startsWith(`..${sep}`) || isAbsolute(candidateRelative)) {
    throw new Error(`Entrypoint reference escapes the output root: ${reference}`);
  }

  let candidateReal;
  try {
    candidateReal = await realpath(candidate);
  } catch {
    throw new Error(`Entrypoint asset is missing: ${reference}`);
  }
  const realRelative = relative(outputRootReal, candidateReal);
  if (realRelative === "" || realRelative === ".." || realRelative.startsWith(`..${sep}`) || isAbsolute(realRelative)) {
    throw new Error(`Entrypoint asset resolves outside the output root: ${reference}`);
  }
  return candidateReal;
}

export async function checkBundle({ budgetBytes = entrypointBudgetBytes, outputRoot = defaultOutputRoot } = {}) {
  const outputRootReal = await realpath(outputRoot);
  const files = await walk(outputRootReal);
  const sourceMaps = files.filter((file) => file.endsWith(".map"));
  if (sourceMaps.length > 0) throw new Error(`Production source maps are forbidden: ${sourceMaps.map((file) => relative(appRoot, file)).join(", ")}`);

  for (const file of files.filter((candidate) => candidate.endsWith(".js") || candidate.endsWith(".html"))) {
    const content = await readFile(file, "utf8");
    const matched = forbiddenPatterns.find((pattern) => pattern.test(content));
    if (matched) throw new Error(`Forbidden production bundle content ${String(matched)} in ${relative(appRoot, file)}`);
  }

  const indexPath = join(outputRootReal, "index.html");
  const html = await readFile(indexPath, "utf8");
  const references = initialAssetReferences(html);
  if (!references.some((reference) => new URL(reference, "https://internal-mobile.invalid/").pathname.endsWith(".js"))) {
    throw new Error("Production index.html has no initial JavaScript entrypoint.");
  }
  if (!references.some((reference) => new URL(reference, "https://internal-mobile.invalid/").pathname.endsWith(".css"))) {
    throw new Error("Production index.html has no initial stylesheet entrypoint.");
  }

  const resolvedEntrypointFiles = await Promise.all(references.map((reference) => resolveInitialAsset(outputRootReal, outputRootReal, reference)));
  const entrypointFiles = [...new Set(resolvedEntrypointFiles)];
  const entrypointSizes = await Promise.all(entrypointFiles.map(async (file) => (await stat(file)).size));
  const entrypointBytes = entrypointSizes.reduce((sum, size) => sum + size, 0);
  if (entrypointBytes > budgetBytes) throw new Error(`H5 entrypoint is ${entrypointBytes} bytes; budget is ${budgetBytes} bytes.`);

  return { entrypointBytes, entrypointFiles, entrypointReferences: references };
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await checkBundle();
  process.stdout.write(`Internal mobile bundle check passed (${result.entrypointBytes}/${entrypointBudgetBytes} bytes).\n`);
}
