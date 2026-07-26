import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve(import.meta.dirname, "../dist/web");
const manifest = JSON.parse(await readFile(resolve(outputDirectory, ".vite/manifest.json"), "utf8"));
const entries = Object.values(manifest);
const applicationEntry = entries.find((entry) => entry.isEntry === true);

if (!applicationEntry) throw new Error("Workbench bundle manifest has no application entry.");
if (!Array.isArray(applicationEntry.dynamicImports) || applicationEntry.dynamicImports.length === 0) {
  throw new Error("Workbench routes must include at least one lazy-loaded route chunk.");
}

function collectStatic(entry, files) {
  if (files.has(entry.file)) return;
  files.add(entry.file);
  for (const imported of entry.imports ?? []) {
    const dependency = manifest[imported];
    if (!dependency) throw new Error(`Bundle manifest import ${imported} is missing.`);
    collectStatic(dependency, files);
  }
}

const initialFiles = new Set();
collectStatic(applicationEntry, initialFiles);

const jsEntries = entries.filter((entry) => entry.file.endsWith(".js"));
const sizes = new Map();
for (const entry of jsEntries) sizes.set(entry.file, (await stat(resolve(outputDirectory, entry.file))).size);

const maximumChunkBytes = 800 * 1024;
const maximumEntryBytes = 180 * 1024;
const maximumInitialBytes = 1_000 * 1024;
const maximumRouteBytes = 1_200 * 1024;
const oversized = [...sizes].filter(([, size]) => size > maximumChunkBytes);
const initialBytes = [...initialFiles].reduce((total, file) => total + (sizes.get(file) ?? 0), 0);
const entryBytes = sizes.get(applicationEntry.file) ?? 0;

if (oversized.length > 0) {
  throw new Error(`Bundle chunks exceed ${maximumChunkBytes} bytes: ${oversized.map(([file, size]) => `${file}=${size}`).join(", ")}`);
}
if (entryBytes > maximumEntryBytes) throw new Error(`Application entry exceeds ${maximumEntryBytes} bytes: ${entryBytes}.`);
if (initialBytes > maximumInitialBytes) throw new Error(`Initial JavaScript exceeds ${maximumInitialBytes} bytes: ${initialBytes}.`);

const routeTotals = new Map();
for (const source of applicationEntry.dynamicImports) {
  const routeEntry = manifest[source];
  if (!routeEntry) throw new Error(`Dynamic route ${source} is missing from the bundle manifest.`);
  const routeFiles = new Set(initialFiles);
  collectStatic(routeEntry, routeFiles);
  const total = [...routeFiles].reduce((sum, file) => sum + (sizes.get(file) ?? 0), 0);
  routeTotals.set(source, total);
  if (total > maximumRouteBytes) throw new Error(`Route ${source} exceeds ${maximumRouteBytes} bytes: ${total}.`);
}

for (const source of ["src/overview-page.tsx", "src/pages.tsx", "src/settings-page.tsx", "src/status-route-page.tsx"]) {
  if (!routeTotals.has(source)) throw new Error(`Required lazy route entry ${source} is missing.`);
}

const names = [...sizes.keys()];
for (const expected of ["vendor-pro-layout", "vendor-query", "vendor-react"]) {
  if (!names.some((name) => name.includes(expected))) throw new Error(`Required vendor chunk ${expected} is missing.`);
}

console.log(`Workbench bundle budget passed: entry=${entryBytes} bytes, static-initial=${initialBytes} bytes, routes=${[...routeTotals].map(([source, size]) => `${source}:${size}`).join(", ")}, chunks=${sizes.size}.`);
