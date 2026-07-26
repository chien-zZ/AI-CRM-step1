import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

async function walk(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (["node_modules", "dist", "coverage", ".turbo", ".git", ".runtime"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) results.push(...(await walk(path, predicate)));
    else if (predicate(path)) results.push(path);
  }
  return results;
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function internalPackageName(specifier) {
  if (!specifier.startsWith("@ai-crm/")) return undefined;
  const parts = specifier.split("/");
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined;
}

function isPublicWorkspaceImport(specifier, dependency, targetManifest) {
  if (specifier === dependency) return true;
  const subpath = `.${specifier.slice(dependency.length)}`;
  const exported = targetManifest.exports;
  return exported !== null
    && typeof exported === "object"
    && !Array.isArray(exported)
    && Object.hasOwn(exported, subpath);
}

export async function analyzeBoundaries(root) {
  const manifests = await walk(root, (path) => path.endsWith(`${sep}package.json`));
  const packages = [];
  for (const manifestPath of manifests) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (typeof manifest.name === "string" && manifest.name.startsWith("@ai-crm/")) {
      packages.push({ root: dirname(manifestPath), manifest });
    }
  }

  const byName = new Map(packages.map((item) => [item.manifest.name, item]));
  const errors = [];
  const graph = new Map(packages.map((item) => [item.manifest.name, new Set()]));

  for (const owner of packages) {
    const sources = await walk(owner.root, (path) => {
      const extension = path.slice(path.lastIndexOf("."));
      return sourceExtensions.has(extension);
    });
    for (const source of sources) {
      const content = await readFile(source, "utf8");
      for (const match of content.matchAll(importPattern)) {
        const specifier = match[1] ?? match[2];
        if (!specifier) continue;
        if (specifier.startsWith(".")) {
          const target = resolve(dirname(source), specifier);
          if (!isInside(owner.root, target)) errors.push(`${relative(root, source)} crosses its package boundary via ${specifier}`);
          continue;
        }
        const dependency = internalPackageName(specifier);
        if (!dependency) continue;
        const targetPackage = byName.get(dependency);
        if (!targetPackage) errors.push(`${relative(root, source)} imports unknown workspace package ${dependency}`);
        else if (!isPublicWorkspaceImport(specifier, dependency, targetPackage.manifest)) errors.push(`${relative(root, source)} deep-imports ${specifier}`);
        if (dependency === owner.manifest.name) continue;
        const declared = { ...owner.manifest.dependencies, ...owner.manifest.devDependencies, ...owner.manifest.peerDependencies };
        if (!(dependency in declared)) errors.push(`${owner.manifest.name} does not declare ${dependency}`);
        graph.get(owner.manifest.name)?.add(dependency);

        const ownerPath = relative(root, owner.root).replaceAll("\\", "/");
        if (ownerPath.startsWith("packages/platform-modules/") && dependency.startsWith("@ai-crm/domain-")) {
          errors.push(`${owner.manifest.name} must not depend on a domain module`);
        }
        if (ownerPath.startsWith("packages/domain-modules/") && dependency !== "@ai-crm/platform-sdk") {
          errors.push(`${owner.manifest.name} may depend only on @ai-crm/platform-sdk and reviewed contracts`);
        }
      }
    }
  }

  const visited = new Set();
  const visiting = new Set();
  function visit(name, trail) {
    if (visiting.has(name)) {
      errors.push(`workspace dependency cycle: ${[...trail, name].join(" -> ")}`);
      return;
    }
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of graph.get(name) ?? []) visit(dependency, [...trail, name]);
    visiting.delete(name);
    visited.add(name);
  }
  for (const name of graph.keys()) visit(name, []);

  return errors;
}

async function main() {
  const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const errors = await analyzeBoundaries(root);
  if (errors.length > 0) {
    console.error("Module boundary violations:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log("Module boundaries and dependency cycles are valid.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
